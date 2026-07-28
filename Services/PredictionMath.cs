using FabRun.Api.Models;

namespace FabRun.Api.Services;

public static class PredictionMath
{
    public static bool TryCalibrateExponent(
        BestEffortComputed? best5k,
        BestEffortComputed? best10k,
        out double exponent)
    {
        exponent = 1.06;
        if (best5k == null || best10k == null) return false;

        var k = Math.Log((double)best10k.timeSec / best5k.timeSec) / Math.Log(10.0 / 5.0);
        k = Math.Clamp(k, 1.04, 1.12);
        exponent = Math.Round(k, 3);
        return true;
    }

    public static PredictionConfidence BuildConfidence(
        BestEffortComputed reference,
        DateTime now,
        bool calibrated,
        List<string> reasons)
    {
        int score = 50;
        var days = (now - reference.dateLocal).TotalDays;

        if (days <= 42)
        {
            score += 25;
            reasons.Add("Effort de référence récent (<= 42 jours).");
        }
        else if (days > 180)
        {
            score -= 20;
            reasons.Add("Effort de référence ancien (> 180 jours).");
        }

        if (reference.distanceKm >= 10.0)
        {
            score += 10;
            reasons.Add("Référence de distance >= 10K.");
        }

        if (reference.method == "streams")
        {
            score += 10;
            reasons.Add("Best effort calculé depuis les streams GPS.");
        }

        if (calibrated)
        {
            score += 5;
        }

        score = Math.Clamp(score, 0, 100);

        var level = score >= 80 ? "high" : score >= 50 ? "medium" : "low";
        if (reasons.Count == 0) reasons.Add("Données insuffisantes.");

        return new PredictionConfidence(score, level, reasons);
    }
}
