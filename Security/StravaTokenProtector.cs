using Microsoft.AspNetCore.DataProtection;

namespace FabRun.Api.Security;

public sealed class StravaTokenProtector
{
    private readonly IDataProtector _protector;

    public StravaTokenProtector(IDataProtectionProvider dataProtection)
    {
        _protector = dataProtection.CreateProtector("FabRun.StravaOAuth.AccessToken.v1");
    }

    public string Protect(string accessToken) => _protector.Protect(accessToken);

    public bool TryUnprotect(string? protectedToken, out string accessToken)
    {
        accessToken = string.Empty;
        if (string.IsNullOrWhiteSpace(protectedToken))
        {
            return false;
        }

        try
        {
            accessToken = _protector.Unprotect(protectedToken);
            return !string.IsNullOrWhiteSpace(accessToken);
        }
        catch
        {
            return false;
        }
    }
}
