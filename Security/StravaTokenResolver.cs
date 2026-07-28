using System.Net.Http.Headers;

namespace FabRun.Api.Security;

public static class StravaTokenResolver
{
    private const int MaximumTokenLength = 2048;

    public static string? Resolve(HttpRequest request, StravaTokenProtector tokenProtector)
    {
        var authorization = request.Headers.Authorization.ToString();
        if (AuthenticationHeaderValue.TryParse(authorization, out var header)
            && string.Equals(header.Scheme, "Bearer", StringComparison.OrdinalIgnoreCase)
            && !string.IsNullOrWhiteSpace(header.Parameter)
            && header.Parameter.Length <= MaximumTokenLength)
        {
            return header.Parameter;
        }

        if (request.Cookies.TryGetValue(SecurityCookies.StravaAccessToken, out var protectedToken)
            && tokenProtector.TryUnprotect(protectedToken, out var accessToken))
        {
            return accessToken;
        }

        return null;
    }
}
