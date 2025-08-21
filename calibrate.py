#!/usr/bin/env python3
"""
Enhanced Magnetometer Calibration Tool

This tool performs magnetometer calibration using ellipsoid fitting to correct for
hard iron and soft iron distortions. It can read data from CSV or TXT files,
perform calibration, apply existing calibrations, and visualize results.

Usage:
    python calibrate.py -f magnetometer_data.csv --plot
    python calibrate.py -f mag_out.txt --json --no-save
    python calibrate.py -f data.csv --apply --plot

Features:
    - Auto-detects CSV vs TXT file formats
    - Supports multiple input units (microTesla, Gauss)
    - Can save/load calibration parameters as JSON
    - Optional before/after visualization
    - Outputs C code and JSON calibration parameters

References:
    - https://github.com/nliaudat/magnetometer_calibration/
    - https://teslabs.com/articles/magnetometer-calibration/
"""

import argparse
import json
import os
import sys
import numpy as np
import pandas as pd
from scipy import linalg
from matplotlib import pyplot as plt


class MagnetometerCalibrator:
    """Magnetometer calibration using ellipsoid fitting method."""
    
    def __init__(self, magnetic_field_strength=1000):
        """
        Initialize calibrator.
        
        Args:
            magnetic_field_strength: Expected magnetic field strength in microTesla
        """
        self.F = magnetic_field_strength
        self.b = np.zeros([3, 1])  # Hard iron bias
        self.A_1 = np.eye(3)       # Soft iron correction matrix
        
    def load_data(self, filename, unit='microtesla'):
        """
        Load magnetometer data from CSV or TXT file.
        
        Args:
            filename: Input file path
            unit: Data unit ('microtesla' or 'gauss')
            
        Returns:
            numpy array of shape (N, 3) with X, Y, Z magnetometer data in microTesla
        """
        file_ext = os.path.splitext(filename)[1].lower()
        
        if file_ext == '.csv':
            data = self._load_csv(filename)
        elif file_ext == '.txt':
            data = self._load_txt(filename)
        else:
            raise ValueError(f"Unsupported file format: {file_ext}")
        
        # Convert to microTesla if needed
        if unit == 'gauss':
            data = data * 100  # 1 Gauss = 100 microTesla
        elif unit == 'microtesla':
            pass  # Already in correct unit
        else:
            raise ValueError(f"Unsupported unit: {unit}")
            
        return data
    
    def _load_csv(self, filename):
        """Load data from CSV file."""
        df = pd.read_csv(filename)
        
        # Try to find expected columns
        mag_cols = ['mag_x_gauss', 'mag_y_gauss', 'mag_z_gauss']
        if all(col in df.columns for col in mag_cols):
            data = df[mag_cols].values * 100  # Convert Gauss to microTesla
        else:
            # Use column position fallback
            if len(df.columns) == 3:
                data = df.iloc[:, [0, 1, 2]].values
            elif len(df.columns) == 4:
                data = df.iloc[:, [1, 2, 3]].values  # Skip timestamp
            else:
                raise ValueError(f"CSV must have 3 or 4 columns, found {len(df.columns)}")
        
        return data
    
    def _load_txt(self, filename):
        """Load data from TXT file."""
        try:
            data = np.loadtxt(filename, delimiter=',')
            if data.shape[1] != 3:
                raise ValueError(f"TXT file must have exactly 3 columns, found {data.shape[1]}")
            return data
        except Exception as e:
            raise ValueError(f"Error loading TXT file: {e}")
    
    def calibrate(self, data):
        """
        Perform magnetometer calibration using ellipsoid fitting.
        
        Args:
            data: numpy array of shape (N, 3) with magnetometer data
        """
        print(f"Calibrating with {len(data)} data points...")
        print(f"Magnetic field strength: {self.F} microTesla")
        
        # Ellipsoid fit
        s = data.T
        M, n, d = self._ellipsoid_fit(s)
        
        # Calculate calibration parameters
        M_1 = linalg.inv(M)
        self.b = -np.dot(M_1, n)
        self.A_1 = np.real(self.F / np.sqrt(np.dot(n.T, np.dot(M_1, n)) - d) * linalg.sqrtm(M))
        
        print("\nCalibration completed!")
        print("Hard iron bias (microTesla):")
        print(f"  X: {self.b[0,0]:.6f}")
        print(f"  Y: {self.b[1,0]:.6f}")
        print(f"  Z: {self.b[2,0]:.6f}")
        print("\nSoft iron transformation matrix:")
        print(self.A_1)
    
    def apply_calibration(self, data):
        """
        Apply calibration to magnetometer data.
        
        Args:
            data: numpy array of shape (N, 3) with raw magnetometer data
            
        Returns:
            numpy array of calibrated data
        """
        # Subtract hard iron bias and apply soft iron correction
        data_corrected = (data - self.b.T) @ self.A_1.T
        return data_corrected
    
    def save_calibration(self, filename):
        """Save calibration parameters to JSON file."""
        calibration_data = {
            "hard_iron_bias": self.b.flatten().tolist(),
            "soft_iron_matrix": self.A_1.tolist(),
            "magnetic_field_strength": self.F,
            "unit": "microtesla"
        }
        
        with open(filename, 'w') as f:
            json.dump(calibration_data, f, indent=4)
        print(f"Calibration saved to {filename}")
    
    def load_calibration(self, filename):
        """Load calibration parameters from JSON file."""
        with open(filename, 'r') as f:
            calibration_data = json.load(f)
        
        self.b = np.array(calibration_data["hard_iron_bias"]).reshape(3, 1)
        self.A_1 = np.array(calibration_data["soft_iron_matrix"])
        self.F = calibration_data.get("magnetic_field_strength", 1000)
        
        print(f"\n Calibration loaded from {filename}")
        print(f"Magnetic field strength: {self.F} microTesla")
    
    def print_c_code(self):
        """Print calibration parameters as C code."""
        print("\n" + "="*50)
        print("C Code for calibration parameters:")
        print("="*50)
        print(f"float hard_iron_bias_x = {self.b[0,0]:.6f};")
        print(f"float hard_iron_bias_y = {self.b[1,0]:.6f};")
        print(f"float hard_iron_bias_z = {self.b[2,0]:.6f};")
        print()
        print(f"double soft_iron_bias_xx = {self.A_1[0,0]:.6f};")
        print(f"double soft_iron_bias_xy = {self.A_1[0,1]:.6f};")
        print(f"double soft_iron_bias_xz = {self.A_1[0,2]:.6f};")
        print()
        print(f"double soft_iron_bias_yx = {self.A_1[1,0]:.6f};")
        print(f"double soft_iron_bias_yy = {self.A_1[1,1]:.6f};")
        print(f"double soft_iron_bias_yz = {self.A_1[1,2]:.6f};")
        print()
        print(f"double soft_iron_bias_zx = {self.A_1[2,0]:.6f};")
        print(f"double soft_iron_bias_zy = {self.A_1[2,1]:.6f};")
        print(f"double soft_iron_bias_zz = {self.A_1[2,2]:.6f};")
        print("="*50)
    
    def print_json_format(self):
        """Print calibration parameters in JSON format."""
        print("\n" + "="*50)
        print("JSON format for calibration parameters:")
        print("="*50)
        calibration_data = {
            "hard_iron_bias": self.b.flatten().tolist(),
            "soft_iron_matrix": self.A_1.tolist(),
            "magnetic_field_strength": self.F,
            "unit": "microtesla"
        }
        print(json.dumps(calibration_data, indent=4))
        print("="*50)
    
    def plot_data(self, data, title):
        """Plot magnetometer data with 3D trajectory and projections."""
        
        alpha = 1  # Transparency for scatter plots
        s = 2      # Size of scatter points
        
        # 3D trajectory
        fig_3d = plt.figure(figsize=(8, 5))
        ax1 = fig_3d.add_subplot(111, projection='3d')
        ax1.plot(data[:, 0], data[:, 1], data[:, 2])
        ax1.set_title(f'{title} Magnetometer Trajectory 3D')
        ax1.set_xlabel('X (µT)')
        ax1.set_ylabel('Y (µT)')
        ax1.set_zlabel('Z (µT)')
        ax1.set_aspect('equal')

        # Calculate limits for consistent scaling
        min_val = np.min(data)
        max_val = np.max(data)

        # Projections figure
        fig_proj = plt.figure(figsize=(16, 4))
            
        # XY projection
        ax_xy = fig_proj.add_subplot(141)
        ax_xy.scatter(data[:, 0], data[:, 1], alpha=alpha, c='red', label='XY plane', s=s)
        ax_xy.set_title(f'{title} Magnetometer XY Projection')
        ax_xy.set_xlabel('X (µT)')
        ax_xy.set_ylabel('Y (µT)')
        ax_xy.set_xlim([min_val, max_val])
        ax_xy.set_ylim([min_val, max_val])
        ax_xy.set_aspect('equal')
        ax_xy.grid(True)
        ax_xy.legend()

        # XZ projection
        ax_xz = fig_proj.add_subplot(142)
        ax_xz.scatter(data[:, 0], data[:, 2], alpha=alpha, c='green', label='XZ plane', s=s)
        ax_xz.set_title(f'{title} Magnetometer XZ Projection')
        ax_xz.set_xlabel('X (µT)')
        ax_xz.set_ylabel('Z (µT)')
        ax_xz.set_xlim([min_val, max_val])
        ax_xz.set_ylim([min_val, max_val])
        ax_xz.set_aspect('equal')
        ax_xz.grid(True)
        ax_xz.legend()

        # YZ projection
        ax_yz = fig_proj.add_subplot(143)
        ax_yz.scatter(data[:, 1], data[:, 2], alpha=alpha, c='blue', label='YZ plane', s=s)
        ax_yz.set_title(f'{title} Magnetometer YZ Projection')
        ax_yz.set_xlabel('Y (µT)')
        ax_yz.set_ylabel('Z (µT)')
        ax_yz.set_xlim([min_val, max_val])
        ax_yz.set_ylim([min_val, max_val])
        ax_yz.set_aspect('equal')
        ax_yz.grid(True)
        ax_yz.legend()

        # Combined XYZ projection
        ax_xyz = fig_proj.add_subplot(144)
        ax_xyz.scatter(data[:, 0], data[:, 1], alpha=alpha, c='red', label='XY plane', s=s)
        ax_xyz.scatter(data[:, 0], data[:, 2], alpha=alpha, c='green', label='XZ plane', s=s)
        ax_xyz.scatter(data[:, 1], data[:, 2], alpha=alpha, c='blue', label='YZ plane', s=s)
        ax_xyz.set_title(f'{title} Magnetometer XYZ Combined')
        ax_xyz.set_xlabel('Coordinate (µT)')
        ax_xyz.set_ylabel('Coordinate (µT)')
        ax_xyz.set_xlim([min_val, max_val])
        ax_xyz.set_ylim([min_val, max_val])
        ax_xyz.set_aspect('equal')
        ax_xyz.grid(True)
        ax_xyz.legend()

        plt.tight_layout()
    
    def _ellipsoid_fit(self, s):
        ''' Estimate ellipsoid parameters from a set of points.

            Parameters
            ----------
            s : array_like
              The samples (M,N) where M=3 (x,y,z) and N=number of samples.

            Returns
            -------
            M, n, d : array_like, array_like, float
              The ellipsoid parameters M, n, d.

            References
            ----------
            .. [1] Qingde Li; Griffiths, J.G., "Least squares ellipsoid specific
               fitting," in Geometric Modeling and Processing, 2004.
               Proceedings, vol., no., pp.335-340, 2004
        '''
        # D (samples)
        D = np.array([s[0]**2., s[1]**2., s[2]**2.,
                      2.*s[1]*s[2], 2.*s[0]*s[2], 2.*s[0]*s[1],
                      2.*s[0], 2.*s[1], 2.*s[2], np.ones_like(s[0])])

        # S, S_11, S_12, S_21, S_22 (eq. 11)
        S = np.dot(D, D.T)
        S_11 = S[:6,:6]
        S_12 = S[:6,6:]
        S_21 = S[6:,:6]
        S_22 = S[6:,6:]

        # C (Eq. 8, k=4)
        C = np.array([[-1,  1,  1,  0,  0,  0],
                      [ 1, -1,  1,  0,  0,  0],
                      [ 1,  1, -1,  0,  0,  0],
                      [ 0,  0,  0, -4,  0,  0],
                      [ 0,  0,  0,  0, -4,  0],
                      [ 0,  0,  0,  0,  0, -4]])

        # v_1 (eq. 15, solution)
        E = np.dot(linalg.inv(C),
                   S_11 - np.dot(S_12, np.dot(linalg.inv(S_22), S_21)))

        E_w, E_v = np.linalg.eig(E)
        v_1 = E_v[:, np.argmax(E_w)]
        if v_1[0] < 0: v_1 = -v_1

        # v_2 (eq. 13, solution)
        v_2 = np.dot(np.dot(-np.linalg.inv(S_22), S_21), v_1)

        # quadratic-form parameters, parameters h and f swapped as per correction by Roger R on Teslabs page
        M = np.array([[v_1[0], v_1[5], v_1[4]],
                      [v_1[5], v_1[1], v_1[3]],
                      [v_1[4], v_1[3], v_1[2]]])
        n = np.array([[v_2[0]],
                      [v_2[1]],
                      [v_2[2]]])
        d = v_2[3]

        return M, n, d


def check_overwrite(filename):
    """Check if file exists and prompt for overwrite permission."""
    if os.path.exists(filename):
        response = input(f"File '{filename}' already exists. Overwrite? [y/N]: ")
        return response.lower() in ['y', 'yes']
    return True


def main():
    parser = argparse.ArgumentParser(
        description="""
Enhanced Magnetometer Calibration Tool

Performs magnetometer calibration using ellipsoid fitting to correct for hard iron 
and soft iron distortions. Supports CSV and TXT input formats, can save/load 
calibration parameters, and provides visualization options.

Examples:
  %(prog)s -f magnetometer_data.csv --plot
  %(prog)s -f mag_out.txt --json --save  
  %(prog)s -f data.csv --apply --field 850 --unit gauss
        """,
        formatter_class=argparse.RawDescriptionHelpFormatter
    )
    
    parser.add_argument('-f', '--file', type=str, default='mag_out.txt',
                       help='Input data file (CSV or TXT format, default: mag_out.txt)')
    parser.add_argument('--apply', type=str, nargs='?', const='default',
                       help='Apply existing calibration from JSON file instead of calibrating. Optionally specify the JSON file path.')
    parser.add_argument('--json', action='store_true',
                       help='Save calibration parameters as JSON file')
    parser.add_argument('--no-save', action='store_false', dest='save', default=True,
                       help='Disable saving calibrated data to file (default: saves data)')
    parser.add_argument('--field', type=float, default=1000,
                       help='Expected magnetic field strength in microTesla (default: 1000)')
    parser.add_argument('--unit', choices=['microtesla', 'gauss'], default='microtesla',
                       help='Input data unit (default: microtesla)')
    parser.add_argument('-p', '--plot', action='store_true',
                       help='Show before/after calibration plots')
    
    args = parser.parse_args()
    
    try:
        # Initialize calibrator
        calibrator = MagnetometerCalibrator(args.field)
        
        # Load data
        print(f"Loading data from {args.file} (unit: {args.unit})...")
        raw_data = calibrator.load_data(args.file, args.unit)
        print(f"Loaded {len(raw_data)} data points")
        
        print("\nFirst 5 raw values (microTesla):")
        print(raw_data[:5])
        
        # Apply existing calibration or perform new calibration
        if args.apply:
            # Use specified calibration file or default to base_name_calibration.json
            if args.apply == 'default':
                base_name = os.path.splitext(args.file)[0]
                calibration_file = f"{base_name}_calibration.json"
            else:
                calibration_file = args.apply
            
            if not os.path.exists(calibration_file):
                print(f"Error: Calibration file '{calibration_file}' not found")
                sys.exit(1)
            
            calibrator.load_calibration(calibration_file)
        else:
            # Perform calibration
            calibrator.calibrate(raw_data)
        
        # Apply calibration
        calibrated_data = calibrator.apply_calibration(raw_data)
        
        print("\nFirst 5 calibrated values (microTesla):")
        print(calibrated_data[:5])
        
        # Print calibration parameters
        if not args.apply:
            calibrator.print_c_code()
            calibrator.print_json_format()
        
        # Save calibration to JSON
        if args.json and not args.apply:
            base_name = os.path.splitext(args.file)[0]
            json_file = f"{base_name}_calibration.json"
            if check_overwrite(json_file):
                calibrator.save_calibration(json_file)
        
        # Save calibrated data
        if args.save:
            base_name = os.path.splitext(args.file)[0]
            file_ext = os.path.splitext(args.file)[1].lower()
            
            if file_ext == '.csv':
                output_file = f"{base_name}_calibrated.csv"
                if check_overwrite(output_file):
                    df = pd.DataFrame(calibrated_data, columns=['mag_x_ut', 'mag_y_ut', 'mag_z_ut'])
                    df.to_csv(output_file, index=False)
                    print(f"Calibrated data saved to {output_file}")
            else:
                output_file = "out.txt"
                if check_overwrite(output_file):
                    np.savetxt(output_file, calibrated_data, fmt='%.6f', delimiter=',')
                    print(f"Calibrated data saved to {output_file}")
        
        # Plot data
        if args.plot:
            print("\nGenerating plots...")
            calibrator.plot_data(raw_data, "Raw")
            calibrator.plot_data(calibrated_data, "Calibrated")
            plt.show()  # Show all plots at once
            
    except Exception as e:
        print(f"Error: {e}")
        sys.exit(1)


if __name__ == "__main__":
    main()