# magnetometer calibration

1) output you raw data from sensor and name it mag_out.txt in format x,y,z (uT)

2) change the "MField" value (line 42) in calibrate.py according to your sensor value (calculation available at begining of calibrate.py)

3) run script and get "Hard Iron Bias" and "Soft Iron bias" matrixes (and c++ according code)

        float hard_iron_bias_x =  41.45884154873271 ;
        float hard_iron_bias_y =  -87.79628696573607 ;
        float hard_iron_bias_z =  569.4171225039286 ;


        double soft_iron_bias_xx =  0.5823136909144911 ;
        double soft_iron_bias_xy =  0.007124620314368133 ;
        double soft_iron_bias_xz =  -0.024442807568982334 ;


        double soft_iron_bias_yx =  0.00712462031436818 ;
        double soft_iron_bias_yy =  0.5906868599676302 ;
        double soft_iron_bias_yz =  0.005356720947343228 ;


        double soft_iron_bias_zx =  -0.024442807568982372 ;
        double soft_iron_bias_zy =  0.005356720947343263 ;
        double soft_iron_bias_zz =  0.7210550285247264 ;

---
If you run esphome, a sample code is included

calibrate.py requires to import : numpy,scipy,matplotlib


