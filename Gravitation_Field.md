## To obtain Gravitation Field (raw format):
    
1) get the Total Field for your location from here:
       http://www.ngdc.noaa.gov/geomag-web (tab Magnetic Field)
   
       es. Total Field = 47,241.3 nT | my val :47'789.7
3) Convert this values to Gauss (1nT = 10E-5G)
   
       es. Total Field = 47,241.3 nT = 0.47241G
5) Convert Total Field to Raw value Total Field, which is the
       Raw Gravitation Field we are searching for
       Read your magnetometer datasheet and find your gain value,
       Which should be the same of the collected raw points
   
       es. on HMC5883L, given +_ 1.3 Ga as Sensor Field Range settings
           Gain (LSB/Gauss) = 1090 
           Raw Total Field = Gain * Total Field
           0.47241 * 1090 = ~515  |
           
        -----------------------------------------------
         gain (LSB/Gauss) values for HMC5883L
            0.88 Ga => 1370 
            1.3 Ga => 1090 
            1.9 Ga => 820
            2.5 Ga => 660 
            4.0 Ga => 440
            4.7 Ga => 390 
            5.6 Ga => 330
            8.1 Ga => 230 
        -----------------------------------------------
	
	
     references :
   
        -  https://teslabs.com/articles/magnetometer-calibration/      
        -  https://www.best-microcontroller-projects.com/hmc5883l.html
