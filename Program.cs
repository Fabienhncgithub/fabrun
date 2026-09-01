using System.Net;
using System.Security.Claims;
using System.Threading.RateLimiting;
using FabRun.Api.Abstractions.External;
using FabRun.Api.Abstractions.Persistence;
using FabRun.Api.Infrastructure.External;
using FabRun.Api.Infrastructure.Persistence;
using FabRun.Api.Security;
using FabRun.Api.Services;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.HttpOverrides;
using Microsoft.AspNetCore.Http.Timeouts;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.OpenApi;

var builder = WebApplication.CreateBuilder(args);

ValidateProductionConfiguration(builder.Configuration, builder.Environment);

var configuredOrigins = builder.Configuration.GetSection("FrontendOrigins").Get<string[]>()
    ?? Array.Empty<string>();
var fallbackOrigin = builder.Configuration["WEB_ORIGIN"]
    ?? builder.Configuration["FrontendOrigin"]
    ?? "http://localhost:5173";
var frontendOrigins = configuredOrigins
    .Append(fallbackOrigin)
    .Where(value => !string.IsNullOrWhiteSpace(value))
    .Select(value => NormalizeOrigin(value!))
    .Distinct(StringComparer.OrdinalIgnoreCase)
    .ToArray();

builder.Services.AddCors(options => options.AddDefaultPolicy(policy =>
    policy.WithOrigins(frontendOrigins)
        .WithHeaders(
            Microsoft.Net.Http.Headers.HeaderNames.ContentType,
            Microsoft.Net.Http.Headers.HeaderNames.Authorization,
            SecurityHeaders.Csrf)
        .WithMethods(HttpMethods.Get, HttpMethods.Post, HttpMethods.Put, HttpMethods.Options)
        .AllowCredentials()));

builder.Services
    .AddHttpClient<IStravaClient, StravaApiClient>(client =>
    {
        client.Timeout = TimeSpan.FromSeconds(30);
        client.MaxResponseContentBufferSize = 4 * 1024 * 1024;
        client.DefaultRequestHeaders.UserAgent.ParseAdd("FabRun/1.0");
    });
builder.Services.AddSingleton<ISleepRepository, FileSleepRepository>();
builder.Services.AddSingleton<IBestEffortsRepository, FileBestEffortsRepository>();
builder.Services.AddSingleton<IAthleteSettingsRepository, FileAthleteSettingsRepository>();
builder.Services.AddSingleton<HealthSleepService>();
builder.Services.AddSingleton<BestEffortsStoreService>();
builder.Services.AddSingleton<BestEffortsService>();
builder.Services.AddSingleton<AthleteSettingsService>();
builder.Services.AddSingleton<StravaTokenProtector>();
builder.Services.AddSingleton<StravaTokenService>();
builder.Services.AddMemoryCache();
builder.Services.AddRequestTimeouts(options =>
{
    options.DefaultPolicy = new RequestTimeoutPolicy
    {
        Timeout = TimeSpan.FromSeconds(90),
        TimeoutStatusCode = StatusCodes.Status504GatewayTimeout
    };
});
builder.Services.AddAntiforgery(options =>
{
    options.HeaderName = SecurityHeaders.Csrf;
    options.Cookie.Name = SecurityCookies.Csrf;
    options.Cookie.HttpOnly = true;
    options.Cookie.SecurePolicy = CookieSecurePolicy.Always;
    options.Cookie.SameSite = SameSiteMode.Strict;
    options.Cookie.Path = "/";
    options.Cookie.IsEssential = true;
});
builder.Services.AddControllersWithViews(options =>
{
    options.Filters.Add(new AutoValidateAntiforgeryTokenAttribute());
});
builder.Services
    .AddAuthentication(CookieAuthenticationDefaults.AuthenticationScheme)
    .AddCookie(options =>
    {
        options.Cookie.Name = SecurityCookies.Access;
        options.Cookie.HttpOnly = true;
        options.Cookie.SecurePolicy = CookieSecurePolicy.Always;
        options.Cookie.SameSite = SameSiteMode.Lax;
        options.Cookie.Path = "/";
        options.Cookie.IsEssential = true;
        options.ExpireTimeSpan = TimeSpan.FromHours(12);
        options.SlidingExpiration = true;
        options.Events.OnValidatePrincipal = context =>
        {
            var configuredVersion = builder.Configuration["FABRUN_SESSION_VERSION"];
            var ticketVersion = context.Principal?.FindFirstValue(SecurityClaims.SessionVersion);
            if (string.IsNullOrWhiteSpace(configuredVersion)
                || !string.Equals(ticketVersion, configuredVersion, StringComparison.Ordinal))
            {
                context.RejectPrincipal();
                return context.HttpContext.SignOutAsync(CookieAuthenticationDefaults.AuthenticationScheme);
            }

            return Task.CompletedTask;
        };
        options.Events.OnRedirectToLogin = context =>
        {
            context.Response.StatusCode = StatusCodes.Status401Unauthorized;
            return Task.CompletedTask;
        };
        options.Events.OnRedirectToAccessDenied = context =>
        {
            context.Response.StatusCode = StatusCodes.Status403Forbidden;
            return Task.CompletedTask;
        };
    });
builder.Services.Configure<ForwardedHeadersOptions>(options =>
{
    options.ForwardedHeaders = ForwardedHeaders.XForwardedFor | ForwardedHeaders.XForwardedProto;
    options.ForwardLimit = 1;

    var knownProxy = builder.Configuration["ReverseProxy:KnownProxy"];
    if (!string.IsNullOrWhiteSpace(knownProxy) && IPAddress.TryParse(knownProxy, out var proxyAddress))
    {
        options.KnownIPNetworks.Clear();
        options.KnownProxies.Clear();
        options.KnownProxies.Add(proxyAddress);
    }
});
builder.Services.AddRateLimiter(options =>
{
    options.RejectionStatusCode = StatusCodes.Status429TooManyRequests;
    options.GlobalLimiter = PartitionedRateLimiter.Create<HttpContext, string>(context =>
        FixedWindow(context, permitLimit: 120, window: TimeSpan.FromMinutes(1)));
    options.AddPolicy("login", context =>
        FixedWindow(context, permitLimit: 5, window: TimeSpan.FromMinutes(5)));
    options.AddPolicy("strava-heavy", context =>
        FixedWindow(context, permitLimit: 6, window: TimeSpan.FromMinutes(5)));
    options.AddPolicy("strava-analysis", context =>
        FixedWindow(context, permitLimit: 2, window: TimeSpan.FromMinutes(10)));
});
builder.Services.AddAuthorization(options =>
{
    // Dev convenience: opt-in, explicit flag (appsettings.Development.json)
    // to skip typing the access password on localhost. Read live per-request
    // (not captured at startup) so the security integration tests -- which
    // run under "Development" on purpose to exercise the real auth gate --
    // can override it via their own configuration. Production can never
    // enable this: ValidateProductionConfiguration above doesn't read it,
    // and it's not set in any non-Development appsettings file.
    options.FallbackPolicy = new AuthorizationPolicyBuilder()
        .RequireAssertion(context =>
        {
            if (context.User.Identity?.IsAuthenticated == true)
            {
                return true;
            }

            if (context.Resource is not HttpContext httpContext)
            {
                return false;
            }

            var services = httpContext.RequestServices;
            var environment = services.GetRequiredService<IHostEnvironment>();
            var configuration = services.GetRequiredService<IConfiguration>();
            return environment.IsDevelopment()
                && configuration.GetValue<bool>("FABRUN_DEV_SKIP_ACCESS_PASSWORD");
        })
        .Build();
});
builder.Services.AddEndpointsApiExplorer();
builder.Services.AddSwaggerGen(options =>
{
    options.SwaggerDoc("v1", new OpenApiInfo { Title = "FabRun API", Version = "v1" });
});

var app = builder.Build();

app.UseForwardedHeaders();
if (!app.Environment.IsDevelopment())
{
    app.UseHttpsRedirection();
}

app.Use(async (context, next) =>
{
    if (IsSensitivePath(context.Request.Path))
    {
        context.Response.OnStarting(() =>
        {
            context.Response.Headers.CacheControl = "private, no-store";
            context.Response.Headers.Pragma = "no-cache";
            context.Response.Headers.Expires = "0";
            return Task.CompletedTask;
        });
    }

    await next();
});
app.Use(async (context, next) =>
{
    try
    {
        await next();
    }
    catch (HttpRequestException ex) when (!context.Response.HasStarted)
    {
        var (statusCode, message) = MapUpstreamError(ex);
        app.Logger.LogWarning(
            ex,
            "Upstream Strava request failed with mapped status {StatusCode}",
            statusCode);
        context.Response.Clear();
        context.Response.StatusCode = statusCode;
        context.Response.ContentType = "application/json";
        await context.Response.WriteAsJsonAsync(
            new { error = message },
            cancellationToken: context.RequestAborted);
    }
});
app.UseRateLimiter();
app.UseRequestTimeouts();
app.UseCors();
app.UseAuthentication();
app.UseAuthorization();
if (app.Environment.IsDevelopment())
{
    app.UseSwagger();
    app.UseSwaggerUI();
}
app.MapControllers();

app.Run();

static RateLimitPartition<string> FixedWindow(HttpContext context, int permitLimit, TimeSpan window)
{
    var partitionKey = context.Connection.RemoteIpAddress?.ToString() ?? "unknown";
    return RateLimitPartition.GetFixedWindowLimiter(
        partitionKey,
        _ => new FixedWindowRateLimiterOptions
        {
            PermitLimit = permitLimit,
            Window = window,
            QueueLimit = 0,
            AutoReplenishment = true
        });
}

static bool IsSensitivePath(PathString path) =>
    path.StartsWithSegments("/api")
    || path.StartsWithSegments("/auth")
    || path.StartsWithSegments("/oauth")
    || path.StartsWithSegments("/access");

static (int StatusCode, string Message) MapUpstreamError(HttpRequestException exception) =>
    exception.StatusCode switch
    {
        HttpStatusCode.Unauthorized => (
            StatusCodes.Status401Unauthorized,
            "Token Strava invalide ou expiré. Reconnecte-toi."),
        HttpStatusCode.Forbidden => (
            StatusCodes.Status403Forbidden,
            exception.Message.Contains("inactive", StringComparison.OrdinalIgnoreCase)
                ? "L'application API Strava est inactive. Active-la depuis les paramètres API Strava."
                : "Strava refuse cet accès. Reconnecte-toi et vérifie les autorisations accordées."),
        HttpStatusCode.TooManyRequests => (
            StatusCodes.Status429TooManyRequests,
            "Limite Strava atteinte. Réessaie dans quelques minutes."),
        _ => (
            StatusCodes.Status502BadGateway,
            "Strava est momentanément indisponible. Réessaie plus tard.")
    };

static string NormalizeOrigin(string value)
{
    if (!Uri.TryCreate(value, UriKind.Absolute, out var uri)
        || (uri.Scheme != Uri.UriSchemeHttps && uri.Scheme != Uri.UriSchemeHttp)
        || !string.IsNullOrEmpty(uri.UserInfo)
        || (uri.AbsolutePath != "/" && !string.IsNullOrEmpty(uri.AbsolutePath))
        || !string.IsNullOrEmpty(uri.Query)
        || !string.IsNullOrEmpty(uri.Fragment))
    {
        throw new InvalidOperationException($"Invalid frontend origin configured: {value}");
    }

    return $"{uri.Scheme}://{uri.Authority}";
}

static void ValidateProductionConfiguration(IConfiguration configuration, IWebHostEnvironment environment)
{
    if (!environment.IsProduction())
    {
        return;
    }

    RequireSecret(configuration, "FABRUN_ACCESS_PASSWORD", minimumLength: 20);
    RequireSecret(configuration, "FABRUN_SESSION_VERSION", minimumLength: 16);
    RequireSecret(configuration, "STRAVA_CLIENT_ID", minimumLength: 1);
    RequireSecret(configuration, "STRAVA_CLIENT_SECRET", minimumLength: 16);
    RequireHttpsOrigin(configuration, "BASE_URL");
    RequireHttpsOrigin(configuration, "WEB_ORIGIN");

    var allowedHosts = configuration["AllowedHosts"];
    if (string.IsNullOrWhiteSpace(allowedHosts) || allowedHosts == "*")
    {
        throw new InvalidOperationException("AllowedHosts must contain the production hostname.");
    }

    var knownProxy = configuration["ReverseProxy:KnownProxy"];
    if (!IPAddress.TryParse(knownProxy, out _))
    {
        throw new InvalidOperationException("ReverseProxy:KnownProxy must contain Caddy's private IP address.");
    }
}

static void RequireSecret(IConfiguration configuration, string key, int minimumLength)
{
    var value = configuration[key];
    if (string.IsNullOrWhiteSpace(value)
        || value.Length < minimumLength
        || IsPlaceholder(value))
    {
        throw new InvalidOperationException($"{key} is missing, too short, or still contains a placeholder.");
    }
}

static bool IsPlaceholder(string value) =>
    value.Contains("change-me", StringComparison.OrdinalIgnoreCase)
    || value.Contains("replace-with", StringComparison.OrdinalIgnoreCase)
    || value.StartsWith("your-", StringComparison.OrdinalIgnoreCase)
    || value.Contains("votre-", StringComparison.OrdinalIgnoreCase)
    || value.Contains("un-mot-de-passe", StringComparison.OrdinalIgnoreCase)
    || value.Contains("une-valeur", StringComparison.OrdinalIgnoreCase)
    || value.Contains("identifiant-strava", StringComparison.OrdinalIgnoreCase)
    || value.Contains("secret-strava", StringComparison.OrdinalIgnoreCase);

static void RequireHttpsOrigin(IConfiguration configuration, string key)
{
    var value = configuration[key];
    if (string.IsNullOrWhiteSpace(value)
        || !Uri.TryCreate(value, UriKind.Absolute, out var uri)
        || uri.Scheme != Uri.UriSchemeHttps
        || !string.IsNullOrEmpty(uri.UserInfo)
        || (uri.AbsolutePath != "/" && !string.IsNullOrEmpty(uri.AbsolutePath))
        || !string.IsNullOrEmpty(uri.Query)
        || !string.IsNullOrEmpty(uri.Fragment))
    {
        throw new InvalidOperationException($"{key} must be an HTTPS origin without a path, query, or fragment.");
    }
}

public partial class Program;
