"""python -m fluixel.run_display output.csv --calibration compensated"""
import argparse
from pathlib import Path
from .pipeline import simulate_captured_s
from .command_adapter import display_rows
from .export import MachineParameters, write_csv


def main(argv=None):
    parser=argparse.ArgumentParser(description='Compute the fixed captured S preset without Rhino; export machine CSV.')
    parser.add_argument('output',type=Path)
    parser.add_argument('--calibration',choices=['original','compensated'],default='original')
    parser.add_argument('--unit',choices=['steps','segments'],default='steps')
    parser.add_argument('--speed',type=float,default=400)
    parser.add_argument('--k-gas',type=float,default=606)
    parser.add_argument('--k-liquid',type=float,default=625)
    args=parser.parse_args(argv)
    if args.output.exists():parser.error('output already exists; choose a new filename')
    try:
        display=simulate_captured_s(calibration=args.calibration)
        rows=display_rows(display,machine=MachineParameters(args.speed,args.k_gas,args.k_liquid),unit=args.unit)
        write_csv(args.output,rows)
    except (ValueError,TypeError,OSError) as exc:
        parser.error(str(exc))
    print(f'Pattern: {display.pattern_id}; calibration: {display.calibration}')
    print(f'Path: {display.path.length:.6f} mm; physical segments: {len(display.sequence.segments)}')
    print(f'Export: {len(rows)} rows, {args.unit}; {args.output}')


if __name__=='__main__':main()
