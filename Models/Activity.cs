namespace FabRun.Api.Models;

public record Activity(
    long id,
    string sport_type,
    double distance,
    int moving_time,
    double total_elevation_gain,
    string start_date_local,
    double? average_speed,
    string name,
    double? calories = null,
    double? kilojoules = null
);
