using Microsoft.AspNetCore.Mvc;
using System.Linq; // pour .Select()
using FabRun.Api.Services;
using BestEffort = FabRun.Api.Models.BestEffort;

namespace FabRun.Api.Controllers
{
    [ApiController]
    [Route("api")]
    public class ActivitiesController : ControllerBase
    {
        private readonly StravaService _strava;
        public ActivitiesController(StravaService strava) => _strava = strava;

        [HttpGet("activities")]
        public async Task<IActionResult> GetActivities()
        {
            var auth = Request.Headers.Authorization.ToString();
            if (string.IsNullOrWhiteSpace(auth) || !auth.StartsWith("Bearer ")) return Unauthorized();
            var token = auth["Bearer ".Length..];

            var acts = await _strava.FetchActivitiesAsync(token);
            return Ok(acts);
        }

        [HttpGet("kpis")]
        public async Task<IActionResult> GetKpis()
        {
            var auth = Request.Headers.Authorization.ToString();
            if (string.IsNullOrWhiteSpace(auth) || !auth.StartsWith("Bearer ")) return Unauthorized();
            var token = auth["Bearer ".Length..];

            var kpis = await _strava.BuildKpisAsync(token);
            return Ok(kpis);
        }

        [HttpGet("predict")]
        public async Task<IActionResult> Predict([FromQuery] int windowDays = 365, [FromQuery] double exponent = 1.06)
        {
            var auth = Request.Headers.Authorization.ToString();
            if (string.IsNullOrWhiteSpace(auth) || !auth.StartsWith("Bearer "))
                return Unauthorized(new { error = "Missing Bearer token" });
            var token = auth["Bearer ".Length..];

            var acts = await _strava.FetchActivitiesAsync(token);
            var since = DateTime.UtcNow.AddDays(-windowDays);

            var best = StravaService.PickBestReferenceFromActivities(acts, since);
            if (best == null)
                return NotFound(new { error = "Aucune course 5K/10K/semi trouvée dans la période." });

            const double M = 42.195;
            var raw = StravaService.RiegelPredictSeconds(best.seconds, best.distKm, M, exponent);
            var adj = raw;

            static string HMS(int sec){int h=sec/3600,m=(sec%3600)/60,s=sec%60;return $"{h}:{m:00}:{s:00}";}
            static string Pace(double km,int sec){var spk=sec/km;int m=(int)(spk/60),s=(int)Math.Round(spk%60);return $"{m}:{s:00}/km";}

            return Ok(new {
                reference = new { best.kind, dist_km = Math.Round(best.distKm,2), time_hms = HMS(best.seconds), date = best.date },
                riegel_exponent = exponent,
                marathon = new { raw_hms = HMS(raw), adjusted_hms = HMS(adj), pace = Pace(M, adj) }
            });
        }

        [HttpGet("best/5k")]
        public async Task<IActionResult> Best5k([FromQuery] int days = 365, [FromQuery] int limit = 10)
        {
            var token = GetBearerOrCookie();
            if (string.IsNullOrWhiteSpace(token)) return Unauthorized();

            var list = await _strava.GetTopBest5kAsync(token, days, limit);
            return Ok(Format(list));
        }

        [HttpGet("best/10k")]
        public async Task<IActionResult> Best10k([FromQuery] int days = 365, [FromQuery] int limit = 10)
        {
            var token = GetBearerOrCookie();
            if (string.IsNullOrWhiteSpace(token)) return Unauthorized();

            var list = await _strava.GetTopBestXAsync(token, 10_000, "10K", days, limit);
            return Ok(Format(list));
        }

        [HttpGet("best/half")]
        public async Task<IActionResult> BestHalf([FromQuery] int days = 365, [FromQuery] int limit = 10)
        {
            var token = GetBearerOrCookie();
            if (string.IsNullOrWhiteSpace(token)) return Unauthorized();

            var list = await _strava.GetTopBestXAsync(token, 21_097.5, "HM", days, limit);
            return Ok(Format(list));
        }

        [HttpGet("best/marathon")]
        public async Task<IActionResult> BestMarathon([FromQuery] int days = 365, [FromQuery] int limit = 10)
        {
            var token = GetBearerOrCookie();
            if (string.IsNullOrWhiteSpace(token)) return Unauthorized();

            var list = await _strava.GetTopBestXAsync(token, 42_195, "M", days, limit);
            return Ok(Format(list));
        }

        private string? GetBearerOrCookie()
        {
            var auth = Request.Headers.Authorization.ToString();
            if (!string.IsNullOrWhiteSpace(auth) && auth.StartsWith("Bearer "))
                return auth["Bearer ".Length..];

            if (Request.Cookies.TryGetValue("strava_access_token", out var cookieToken))
                return cookieToken;

            return null;
        }

        private static object Format(IEnumerable<BestEffort> items) =>
            items.Select(r => new {
                r.activityId,
                r.activityName,
                date = r.dateLocal,
                dist_km = r.distKm,
                r.seconds,
                time_hms = ToHMS(r.seconds),
                pace = PacePerKm(r.seconds, r.distKm),
                start_km = Math.Round(r.startKm, 2),
                end_km = Math.Round(r.endKm, 2),
                strava_url = $"https://www.strava.com/activities/{r.activityId}"
            });

        private static string ToHMS(int sec)
        {
            int h = sec / 3600, m = (sec % 3600) / 60, s = sec % 60;
            return h > 0 ? $"{h}:{m:00}:{s:00}" : $"{m}:{s:00}";
        }

        private static string PacePerKm(int sec, double km)
        {
            var spk = sec / km;
            int m = (int)(spk / 60), s = (int)Math.Round(spk % 60);
            return $"{m}:{s:00}/km";
        }
    }
}
