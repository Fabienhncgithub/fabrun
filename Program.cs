using FabRun.Api.Services;
var builder = WebApplication.CreateBuilder(args);

builder.Services.AddCors(o => o.AddDefaultPolicy(p =>
{
    var origin = builder.Configuration["FrontendOrigin"] ?? "http://localhost:5173";
    p.WithOrigins(origin)
        .AllowAnyHeader()
        .AllowAnyMethod()
        .AllowCredentials();
}));

builder.Services.AddHttpClient<StravaService>();
builder.Services.AddControllers();

var app = builder.Build();

app.UseCors();
app.MapControllers();

app.Run();
