# Campus Sensors data source (Zeynep Sudem)

Reads Boğaziçi campus sensor data (temperature, humidity, energy, occupancy) from a REST API.

- Query editor: building (or dashboard variable), metric, format (time series / table), aggregation, interval, alias
- Live mode: history over REST, then one point per second over WebSocket
- Optional ground-truth anomaly labels (used to score the Insight panel's AI)
- Dashboard variables: `buildings`, `metrics`
- Readable errors (API down, unknown building, bad key); API key stored in `secureJsonData`, added by the Grafana data proxy

Developed by Zeynep Sudem for MIS 233 Advanced Web Development, Boğaziçi University, Fall 2026.
