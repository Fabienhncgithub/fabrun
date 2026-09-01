using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using System.Net;
using System.Linq; // pour .Select()
using System.ComponentModel.DataAnnotations;
using FabRun.Api.Abstractions.External;
using FabRun.Api.Services;
using FabRun.Api.Security;
using BestEffort = FabRun.Api.Models.BestEffort;

namespace FabRun.Api.Controllers
{
    [ApiController]
    [Route("api")]
    public class ActivitiesController : ControllerBase
    {
        private readonly IStravaClient _strava;
        private readonly HealthSleepService _sleep;
        private readonly StravaTokenService _tokenService;

        public ActivitiesController(
            IStravaClient strava,
            HealthSleepService sleep,
            StravaTokenService tokenService)
        {
            _strava = strava;
            _sleep = sleep;
            _tokenService = tokenService;
        }

        [HttpGet("activities")]
        public async Task<IActionResult> GetActivities(CancellationToken cancellationToken)
        {
            var token = await GetAccessTokenAsync(cancellationToken);
            if (string.IsNullOrWhiteSpace(token)) return Unauthorized();

            try
            {
                var acts = await _strava.FetchActivitiesAsync(token, cancellationToken: cancellationToken);
                return Ok(acts);
            }
            catch (HttpRequestException ex) when (TryMapStravaError(ex, out var mapped))
            {
                return mapped;
            }
        }

        [HttpGet("kpis")]
        public async Task<IActionResult> GetKpis(CancellationToken cancellationToken)
        {
            var token = await GetAccessTokenAsync(cancellationToken);
            if (string.IsNullOrWhiteSpace(token)) return Unauthorized();

            try
            {
                var kpis = await _strava.BuildKpisAsync(token, cancellationToken: cancellationToken);
                return Ok(kpis);
            }
            catch (HttpRequestException ex) when (TryMapStravaError(ex, out var mapped))
            {
                return mapped;
            }
        }

        [HttpGet("profile")]
        public async Task<IActionResult> GetProfile(CancellationToken cancellationToken)
        {
            var token = await GetAccessTokenAsync(cancellationToken);
            if (string.IsNullOrWhiteSpace(token)) return Unauthorized();

            try
            {
                var profile = await _strava.FetchAthleteProfileAsync(token, cancellationToken);
                return Ok(profile);
            }
            catch (HttpRequestException ex) when (TryMapStravaError(ex, out var mapped))
            {
                return mapped;
            }
        }

        [HttpGet("dashboard")]
        [EnableRateLimiting("strava-heavy")]
        public async Task<IActionResult> GetDashboard(
            [FromQuery] bool refresh = false,
            CancellationToken cancellationToken = default)
        {
            var token = await GetAccessTokenAsync(cancellationToken);
            if (string.IsNullOrWhiteSpace(token)) return Unauthorized();

            try
            {
                // Pull complet pour calculer les KPI "depuis toujours" correctement.
                // Profil et activités sont indépendants : les charger en parallèle
                // évite d'ajouter la latence du profil à celle de la pagination.
                var activitiesTask = _strava.FetchActivitiesAsync(token, null, cancellationToken, refresh);
                var profileTask = _strava.FetchAthleteProfileAsync(token, cancellationToken, refresh);
                await Task.WhenAll(activitiesTask, profileTask);
                var allActivities = await activitiesTask;

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
                var previousYearActivities = allActivities.Where(a =>
                {
                    if (!DateTime.TryParse(a.start_date_local, out var parsed))
                    {
                        return false;
                    }

                    return parsed.Year == currentYear - 1;
                });
                var kpisPreviousYear = StravaAnalytics.ComputeKpis(previousYearActivities, "previous_year");
                var heatmapActivities = allActivities.Where(a =>
                {
                    if (!DateTime.TryParse(a.start_date_local, out var parsed))
                    {
                        return false;
                    }

                    return parsed.Year >= currentYear - 1 && parsed.Year <= currentYear;
                }).ToList();
                var profile = await profileTask;
                var sleepSummary = await _sleep.GetSummaryAsync(profile.id);

                return Ok(new
                {
                    activities,
                    heatmapActivities,
                    kpis,
                    kpisCurrentYear,
                    kpisPreviousYear,
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
        [EnableRateLimiting("strava-heavy")]
        public async Task<IActionResult> Predict(
            [FromQuery, Range(1, 3650)] int windowDays = 365,
            [FromQuery, Range(1.0, 1.2)] double exponent = 1.06,
            CancellationToken cancellationToken = default)
        {
            var token = await GetAccessTokenAsync(cancellationToken);
            if (string.IsNullOrWhiteSpace(token))
                return Unauthorized(new { error = "Missing Bearer token" });

            var acts = await _strava.FetchActivitiesAsync(token, cancellationToken: cancellationToken);
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
        [EnableRateLimiting("strava-heavy")]
        public async Task<IActionResult> Best5k(
            [FromQuery, Range(1, 3650)] int days = 365,
            [FromQuery, Range(1, 100)] int limit = 10,
            CancellationToken cancellationToken = default)
        {
            var token = await GetAccessTokenAsync(cancellationToken);
            if (string.IsNullOrWhiteSpace(token)) return Unauthorized();

            var list = await _strava.GetTopBest5kAsync(token, days, limit, cancellationToken);
            return Ok(Format(list));
        }

        [HttpGet("best/10k")]
        [EnableRateLimiting("strava-heavy")]
        public async Task<IActionResult> Best10k(
            [FromQuery, Range(1, 3650)] int days = 365,
            [FromQuery, Range(1, 100)] int limit = 10,
            CancellationToken cancellationToken = default)
        {
            var token = await GetAccessTokenAsync(cancellationToken);
            if (string.IsNullOrWhiteSpace(token)) return Unauthorized();

            var list = await _strava.GetTopBestXAsync(token, 10_000, "10K", days, limit, cancellationToken);
            return Ok(Format(list));
        }

        [HttpGet("best/half")]
        [EnableRateLimiting("strava-heavy")]
        public async Task<IActionResult> BestHalf(
            [FromQuery, Range(1, 3650)] int days = 365,
            [FromQuery, Range(1, 100)] int limit = 10,
            CancellationToken cancellationToken = default)
        {
            var token = await GetAccessTokenAsync(cancellationToken);
            if (string.IsNullOrWhiteSpace(token)) return Unauthorized();

            var list = await _strava.GetTopBestXAsync(token, 21_097.5, "HM", days, limit, cancellationToken);
            return Ok(Format(list));
        }

        [HttpGet("best/marathon")]
        [EnableRateLimiting("strava-heavy")]
        public async Task<IActionResult> BestMarathon(
            [FromQuery, Range(1, 3650)] int days = 365,
            [FromQuery, Range(1, 100)] int limit = 10,
            CancellationToken cancellationToken = default)
        {
            var token = await GetAccessTokenAsync(cancellationToken);
            if (string.IsNullOrWhiteSpace(token)) return Unauthorized();

            var list = await _strava.GetTopBestXAsync(token, 42_195, "M", days, limit, cancellationToken);
            return Ok(Format(list));
        }

        private Task<string?> GetAccessTokenAsync(CancellationToken cancellationToken)
            => _tokenService.ResolveAccessTokenAsync(HttpContext, cancellationToken);

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

            if (ex.StatusCode == HttpStatusCode.Forbidden)
            {
                mapped = StatusCode(StatusCodes.Status403Forbidden, new
                {
                    error = ex.Message.Contains("inactive", StringComparison.OrdinalIgnoreCase)
                        ? "L'application API Strava est inactive. Le propriétaire doit l'activer sur https://www.strava.com/settings/api et disposer d'un abonnement Strava actif."
                        : "Strava refuse l'accès aux activités. Reconnecte-toi et autorise l'accès aux activités privées."
                });
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
