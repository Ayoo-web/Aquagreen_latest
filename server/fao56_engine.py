"""
AquaGreen Smart Irrigation System - Pure Python FAO-56 Engine
Zero external dependencies (uses standard math and datetime).
Can run in any standard Python 3 environment.
"""

import math
from datetime import datetime
from typing import Dict, Any

def compute_fao56(t_min: float, t_max: float, rh_min: float, rh_max: float,
                   wind_speed: float, elevation: float = 25.0, lat: float = 14.5995,
                   k_rs: float = 0.16) -> Dict[str, Any]:
    t_mean = (t_max + t_min) / 2.0

    # 1. Saturation vapor pressure
    e_tmin = 0.6108 * math.exp((17.27 * t_min) / (t_min + 237.3))
    e_tmax = 0.6108 * math.exp((17.27 * t_max) / (t_max + 237.3))
    es = (e_tmin + e_tmax) / 2.0
    ea = (e_tmin * (rh_max / 100.0) + e_tmax * (rh_min / 100.0)) / 2.0

    # 2. Slope & psychrometric constant
    delta = 4098.0 * (0.6108 * math.exp((17.27 * t_mean) / (t_mean + 237.3))) / ((t_mean + 237.3) ** 2)
    pressure = 101.3 * (((293.0 - 0.0065 * elevation) / 293.0) ** 5.26)
    gamma = 0.000665 * pressure

    # 3. Wind speed 2m correction (assuming 1.0m anemometer height)
    u2 = wind_speed * (4.87 / math.log(67.8 * 1.0 - 5.42))

    # 4. Radiation via FAO Hargreaves method
    day_of_year = datetime.utcnow().timetuple().tm_yday
    phi = math.radians(lat)
    dr = 1.0 + 0.033 * math.cos((2.0 * math.pi / 365.0) * day_of_year)
    solar_decl = 0.409 * math.sin((2.0 * math.pi / 365.0) * day_of_year - 1.39)
    clamped_val = max(-1.0, min(1.0, -math.tan(phi) * math.tan(solar_decl)))
    omega_s = math.acos(clamped_val)
    gsc = 0.0820
    ra = ((24.0 * 60.0) / math.pi) * gsc * dr * (
        omega_s * math.sin(phi) * math.sin(solar_decl) +
        math.cos(phi) * math.cos(solar_decl) * math.sin(omega_s)
    )
    rso = (0.75 + 2e-5 * elevation) * ra
    rs = k_rs * math.sqrt(max(0.0, t_max - t_min)) * ra
    rns = (1.0 - 0.23) * rs

    sigma = 4.903e-9
    t_max_k4 = (t_max + 273.16) ** 4
    t_min_k4 = (t_min + 273.16) ** 4
    rs_ratio = min(1.0, max(0.3, rs / rso)) if rso > 0 else 0.7
    rnl = sigma * ((t_max_k4 + t_min_k4) / 2.0) * (0.34 - 0.14 * math.sqrt(max(0.0, ea))) * (1.35 * rs_ratio - 0.35)
    rn = max(0.0, rns - rnl)

    # 5. Penman-Monteith equation
    num = 0.408 * delta * rn + gamma * (900.0 / (t_mean + 273.0)) * u2 * (es - ea)
    den = delta + gamma * (1.0 + 0.34 * u2)
    et0 = max(0.1, round(num / den, 2))

    return {
        "et0": et0,
        "tMean": round(t_mean, 1),
        "tMin": round(t_min, 1),
        "tMax": round(t_max, 1),
        "es": round(es, 3),
        "ea": round(ea, 3),
        "vpd": round(max(0.0, es - ea), 3),
        "rn": round(rn, 2),
        "rsEstimated": round(rs, 2),
        "windSpeed2m": round(u2, 2)
    }
