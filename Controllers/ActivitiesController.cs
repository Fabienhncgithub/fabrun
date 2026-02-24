using Microsoft.AspNetCore.Mvc;
using System.Net;
using System.Linq; // pour .Select()
using FabRun.Api.Abstractions.External;
using FabRun.Api.Services;
using BestEffort = FabRun.Api.Models.BestEffort;

namespace FabRun.Api.Controllers
{
    [ApiController]
    [Route("api")]
    public class ActivitiesController : ControllerBase
    {
        private readonly IStravaClient _strava;
        private readonly HealthSleepService _sleep;
        public ActivitiesController(IStravaClient strava, HealthSleepService sleep)
        {
            _strava = strava;
            _sleep = sleep;
        }

        [HttpGet("activities")]
        public async Task<IActionResult> GetActivities()
        {
            var token = GetBearerOrCookie();
            if (string.IsNullOrWhiteSpace(token)) return Unauthorized();

            try
            {
                var acts = await _strava.FetchActivitiesAsync(token);
                return Ok(acts);
            }
            catch (HttpRequestException ex) when (TryMapStravaError(ex, out var mapped))
            {
                return mapped;
            }
        }

        [HttpGet("kpis")]
        public async Task<IActionResult> GetKpis()
        {
            var token = GetBearerOrCookie();
            if (string.IsNullOrWhiteSpace(token)) return Unauthorized();

            try
            {
                var kpis = await _strava.BuildKpisAsync(token);
                return Ok(kpis);
            }
            catch (HttpRequestException ex) when (TryMapStravaError(ex, out var mapped))
            {
                return mapped;
            }
        }

        [HttpGet("profile")]
        public async Task<IActionResult> GetProfile()
        {
            var token = GetBearerOrCookie();
            if (string.IsNullOrWhiteSpace(token)) return Unauthorized();

            try
            {
                var profile = await _strava.FetchAthleteProfileAsync(token);
                return Ok(profile);
            }
            catch (HttpRequestException ex) when (TryMapStravaError(ex, out var mapped))
            {
                return mapped;
            }
        }

        [HttpGet("dashboard")]
        public async Task<IActionResult> GetDashboard()
        {
            var token = GetBearerOrCookie();
            if (string.IsNullOrWhiteSpace(token)) return Unauthorized();

            try
            {
                // Pull complet pour calculer les KPI "depuis toujours" correctement.
                var allActivities = await _strava.FetchActivitiesAsync(token, null);

                // La table du dashboard reste bornée aux 12 derniers mois pour rester lisible.
                var tableCutoff = DateTime.Today.AddDays(-365);
                var activities = allActivities.Where(a =>
                {
                    if (!DateTime.TryParse(a.start_date_local, out var parsed))
                    {
                        return false;
                    }

                    return parsed >= tableCutoff;
                }).ToList();

                var kpis = StravaAnalytics.ComputeKpis(allActivities, "all_time");
                var currentYear = DateTime.Now.Year;
                var currentYearActivities = allActivities.Where(a =>
                {
                    if (!DateTime.TryParse(a.start_date_local, out var parsed))
                    {
                        return false;
                    }

                    return parsed.Year == currentYear;
                });
                var kpisCurrentYear = StravaAnalytics.ComputeKpis(currentYearActivities, "current_year");
                var profile = await _strava.FetchAthleteProfileAsync(token);
                var sleepSummary = await _sleep.GetSummaryAsync(profile.id);

                return Ok(new
                {
                    activities,
                    kpis,
                    kpisCurrentYear,
                    profile,
                    sleep = sleepSummary
                });
            }
            catch (HttpRequestException ex) when (TryMapStravaError(ex, out var mapped))
            {
                return mapped;
            }
        }

        [HttpGet("predict")]
        public async Task<IActionResult> Predict([FromQuery] int windowDays = 365, [FromQuery] double exponent = 1.06)
        {
            var token = GetBearerOrCookie();
            if (string.IsNullOrWhiteSpace(token))
                return Unauthorized(new { error = "Missing Bearer token" });

            var acts = await _strava.FetchActivitiesAsync(token);
            var since = DateTime.UtcNow.AddDays(-windowDays);

            var best = StravaAnalytics.PickBestReferenceFromActivities(acts, since);
            if (best == null)
                return NotFound(new { error = "Aucune course 5K/10K/semi trouvée dans la période." });

            const double M = 42.195;
            var raw = StravaAnalytics.RiegelPredictSeconds(best.seconds, best.distKm, M, exponent);
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
            const string bearerPrefix = "Bearer ";
            if (!string.IsNullOrWhiteSpace(auth) &&
                auth.StartsWith(bearerPrefix, StringComparison.OrdinalIgnoreCase))
            {
                return auth[bearerPrefix.Length..].Trim();
            }

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

        private bool TryMapStravaError(HttpRequestException ex, out IActionResult mapped)
        {
            if (ex.StatusCode == HttpStatusCode.Unauthorized)
            {
                mapped = Unauthorized(new { error = "Token Strava invalide ou expiré. Reconnecte-toi." });
                return true;
            }

            if (ex.StatusCode == HttpStatusCode.TooManyRequests)
            {
                mapped = StatusCode(StatusCodes.Status429TooManyRequests, new
                {
                    error = "Limite Strava atteinte (429). Réessaie dans quelques minutes."
                });
                return true;
            }

            mapped = StatusCode(StatusCodes.Status502BadGateway, new
            {
                error = "Erreur Strava en amont. Réessaie plus tard."
            });
            return true;
        }
    }
}
