# Gravitation field (the `--field` value)

The magnetic field magnitude is roughly constant in a fixed location (25–65 µT at the
surface), and the calibration is scaled so that every corrected sample has exactly the
magnitude you pass with `--field`. Get it from NOAA:

1. Open <http://www.ngdc.noaa.gov/geomag-web> (tab *Magnetic Field*) and read the
   **Total Field** for your location:

   ```
   e.g. Total Field = 47,241.3 nT  =  47.24 µT  =  0.47241 G
   ```

2. Use it directly as microtesla: `--field 47.24`.

## Raw sensor units

If your capture holds raw sensor counts rather than µT (an untagged HMC5883L log, for
example), `--field` must be expressed in those same counts. Convert with the datasheet
gain:

```
raw total field = gain (LSB/Gauss) × total field (Gauss)
0.47241 × 1090  = ~515        ->  --field 515
```

Gain values for the HMC5883L (pick the row matching your configured sensor field range):

| Sensor field range | Gain (LSB/Gauss) |
| --- | --- |
| ±0.88 Ga | 1370 |
| ±1.3 Ga | 1090 |
| ±1.9 Ga | 820 |
| ±2.5 Ga | 660 |
| ±4.0 Ga | 440 |
| ±4.7 Ga | 390 |
| ±5.6 Ga | 330 |
| ±8.1 Ga | 230 |

This is where the 1000 default comes from: it is a round *nominal raw* value, not a
physical field strength. A wrong `--field` does not rotate the heading (`atan2` is
scale-invariant) but it does distort the reported `|B|` residual — see
[quality.md](quality.md).

## References

- <https://teslabs.com/articles/magnetometer-calibration/>
- <https://www.best-microcontroller-projects.com/hmc5883l.html>
