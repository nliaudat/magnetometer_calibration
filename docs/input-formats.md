# Input formats

The format is detected automatically (delimiter, header, columns and unit):

| Input | Example | Notes |
| --- | --- | --- |
| TXT, 3 columns | `33.1,98.3,571.2` | comma, semicolon, tab or whitespace separated |
| CSV with header | `time,mag_x_ut,mag_y_ut,mag_z_ut` | the unit suffix (`ut`, `gauss`, `nt`, `tesla`) is used, extra columns are ignored |
| CSV without header | `33.1,98.3,571.2` or `0,33.1,98.3,571.2` | 4 columns: the first is treated as a timestamp |
| Raw logs | `[12:34:56][D][main:090]: 33.1,98.3,571.2` | ESPHome/serial lines, extra text is ignored; use `--extract-pattern` for other layouts |
| stdin | `type mag_out.txt \| python calibrate.py -f - --field 515` | |

`#`/`//`/`;` comment lines, blank lines and unparsable rows are skipped and counted in the
`--report json` output (`rows_used`, `rows_skipped`).
