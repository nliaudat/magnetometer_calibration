# magnetometer calibration

1) output you raw data from sensor and name it mag_out.txt in format x,y,z (uT)

2) change the "MField" value (l42) in calibrate.py according to your sensor value

3) run script and get Hard Iron Bias and Soft Iron bias matrix (and c++ according code)

---
If you run esphome, a sample code is included

calibrate.py requires to import : numpy,scipy,matplotlib
