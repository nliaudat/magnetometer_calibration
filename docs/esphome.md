# ESPHome integration

`--esphome` prints a ready-to-paste lambda using exactly the constant names of
[esphome_code.yaml](../esphome_code.yaml) (see also the C snippet below), including the
`atan2(0 - xm_cal, ym_cal)` heading convention and optional `--declination`.

`--esphome-file esphome_code.yaml --esphome-update` replaces the 12 constants inside the
file in place: all-or-nothing (nothing is written unless every constant is found) and a
`.bak` copy is kept. Example workflow:

```bash
python calibrate.py -f mag_out.txt --field 515 --esphome-file esphome_code.yaml --esphome-update
esphome run esphome_code.yaml
```

### Generated coefficients (C / ESPHome)

Both `--esphome` and the C code block on stdout use these names (the example numbers come
from `mag_out_sample.txt` with `--field 515`):

```c
// Taken from calibrate.py or magcal
float hard_iron_bias_x =  41.168866;
float hard_iron_bias_y =  -89.874657;
float hard_iron_bias_z =  569.663929;

double soft_iron_bias_xx =  2.711938;  double soft_iron_bias_xy =  0.027825;  double soft_iron_bias_xz = -0.113831;
double soft_iron_bias_yx =  0.027825;  double soft_iron_bias_yy =  2.750884;  double soft_iron_bias_yz =  0.029724;
double soft_iron_bias_zx = -0.113831;  double soft_iron_bias_zy =  0.029724;  double soft_iron_bias_zz =  3.357968;

// get values x,y,z and subtract the hard iron offset
float xm_off = id(hmc5883l_x).state - hard_iron_bias_x;
float ym_off = id(hmc5883l_y).state - hard_iron_bias_y;
float zm_off = id(hmc5883l_z).state - hard_iron_bias_z;

// multiply by the inverse soft iron offset
float xm_cal = xm_off * soft_iron_bias_xx + ym_off * soft_iron_bias_yx + zm_off * soft_iron_bias_zx;
float ym_cal = xm_off * soft_iron_bias_xy + ym_off * soft_iron_bias_yy + zm_off * soft_iron_bias_zy;
//not needed : float zm_cal = xm_off * soft_iron_bias_xz + ym_off * soft_iron_bias_yz + zm_off * soft_iron_bias_zz;

//float heading = atan2(ym_cal, xm_cal);
float heading = atan2(0 - xm_cal, ym_cal);

//heading += id(magnetic_declination);

if(id(enable_magnetometer_serial_output) == true){
ESP_LOGD("main", "%.1f,%.1f,%.1f", id(hmc5883l_x).state, id(hmc5883l_y).state, id(hmc5883l_z).state);
}
// Correct for when signs are reversed.
if (heading < 0) {
heading += 2*PI;
}
// Check for wrap due to addition of declination.
if (heading > 2*PI) {
//heading -= 2*PI;
}
float headingDegrees = heading * 180/M_PI; // Convert radians to degrees.
return headingDegrees;
```

The soft iron matrix is symmetric, so the C expression above (`v @ A`) and the Python one
(`v @ Aᵀ`) are equivalent; a warning is printed if a capture ever produces an asymmetric
matrix.

---

If you run [esphome](https://esphome.io), a [sample code is included](../esphome_code.yaml) to
output raw data and get corrected values.
