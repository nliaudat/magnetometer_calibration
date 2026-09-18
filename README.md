# Magnetometer calibration

Ellipsoid fitting using python numpy to calibrate magnetometers:

This tool performs magnetometer calibration using ellipsoid fitting to correct for
hard iron and soft iron distortions. It can read data from CSV or TXT files,
perform calibration, apply existing calibrations, and visualize results.

![alt text](Figure_1.png "Output")
![alt text](Figure_2.png "New Output")



# Web app

The same calibration runs in your browser — no install, nothing uploaded, and the same
algorithm as `calibrate.py`:

* **<https://nliaudat.github.io/magnetometer_calibration/>** (drop in a capture, read the quality
  report, copy the C code / JSON / ESPHome lambda, download the patched YAML);
* **`magcal.html`** — one self-contained file in this repository: double-click it, no server and
  no Python needed.

The port is validated against `calibrate.py` itself: `tools/dump_golden.py` records what the
Python tool computes and `web/tests` checks the JavaScript against it — see
[docs/web-app.md](docs/web-app.md). Locally, `python tools/serve.py --open` serves both the
sources and the built site (double-clicking `web/index.html` cannot work: browsers block ES
modules for `file://` pages).

# Usage :
1) output you raw data from sensor and name it `mag_out.txt` in format x,y,z (uT) or in a csv file

2) optionally set the MField Value according to [Gravitation_Field.md](https://github.com/nliaudat/magnetometer_calibration/blob/main/Gravitation_Field.md)

and use `--field` flag

3) run script
Defaults to `python calibrate.py` with mag_out.txt

Example Usage:
    `python calibrate.py -f magnetometer_data.csv --plot`
    `python calibrate.py -f mag_out.txt --json --save`
    `python calibrate.py -f data.csv --apply already_calibrated_matrix.json --plot`

4) get "Hard Iron Bias" and "Soft Iron bias" matrixes (and c++ according code)



       // Taken from calibrate.py, run on the bundled mag_out_sample.txt with --field 515
       // (the 2021 script printed different soft iron values: it had the v1 index bug that
       // was fixed in commit 61f5ab1, see issue #1)
        float hard_iron_bias_x = 41.168866;
        float hard_iron_bias_y = -89.874657;
        float hard_iron_bias_z = 569.663929;


        double soft_iron_bias_xx = 2.711938;
        double soft_iron_bias_xy = 0.027825;
        double soft_iron_bias_xz = -0.113831;


        double soft_iron_bias_yx = 0.027825;
        double soft_iron_bias_yy = 2.750884;
        double soft_iron_bias_yz = 0.029724;


        double soft_iron_bias_zx = -0.113831;
        double soft_iron_bias_zy = 0.029724;
        double soft_iron_bias_zz = 3.357968;
        
        // get values x,y,z and subtract the hard iron offset
        float xm_off = id(hmc5883l_x).state - hard_iron_bias_x;
        float ym_off = id(hmc5883l_y).state - hard_iron_bias_y;
        float zm_off = id(hmc5883l_z).state - hard_iron_bias_z;
        
        // multiply by the inverse soft iron offset 
        float xm_cal = xm_off *  soft_iron_bias_xx + ym_off *  soft_iron_bias_yx  + zm_off *  soft_iron_bias_zx;
        float ym_cal = xm_off *  soft_iron_bias_xy + ym_off *  soft_iron_bias_yy + zm_off *  soft_iron_bias_zy;
        //not needed : float zm_cal = xm_off *  soft_iron_bias_xz + ym_off *  soft_iron_bias_yz  + zm_off *  soft_iron_bias_zz;
        
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

---
If you run [esphome](https://esphome.io), a [sample code is included](https://github.com/nliaudat/magnetometer_calibration/blob/main/esphome_code.yaml) to output raw data and get corrected values.

# Working demo

If you want a sample or a working demo, look at https://github.com/nliaudat/weatherstation

# Requirements : 
calibrate.py requires numpy,scipy, pandas and optional matplotlib to plot the graph
     
# Thanks : 
[John zhang12300](https://github.com/zhang12300) for issuing the bug

[jremington](https://github.com/jremington) for fixing the bug

[domsl](https://github.com/domsl) for improvements in PR#5

## Sources :
        -  https://teslabs.com/articles/magnetometer-calibration/      
        -  https://www.best-microcontroller-projects.com/hmc5883l.html

