"""python -m fluixer boundary.csv output.csv --unit steps"""
import argparse
import csv
from pathlib import Path
from .export import MachineParameters, build_rows, write_csv


def main():
    parser = argparse.ArgumentParser(description='Export GH boundary values to machine CSV')
    parser.add_argument('input', type=Path)
    parser.add_argument('output', type=Path)
    parser.add_argument('--speed', type=float, default=400)
    parser.add_argument('--k-gas', type=float, default=606)
    parser.add_argument('--k-liquid', type=float, default=625)
    parser.add_argument('--unit', choices=['steps', 'segments'], default='steps')
    parser.add_argument('--overwrite', action='store_true')
    args = parser.parse_args()
    if args.input.resolve() == args.output.resolve():
        parser.error('input and output must differ')
    if args.output.exists() and not args.overwrite:
        parser.error('output exists; use --overwrite explicitly')
    try:
        with args.input.open(encoding='utf-8-sig', newline='') as stream:
            reader = csv.DictReader(stream)
            if reader.fieldnames != ['value', 'liquid_gas']:
                raise ValueError('expected header: value,liquid_gas')
            data = list(reader)
        rows = build_rows([r['value'] for r in data], [r['liquid_gas'] for r in data],
                          MachineParameters(args.speed, args.k_gas, args.k_liquid), args.unit)
        write_csv(args.output, rows)
    except (ValueError, OSError, TypeError) as exc:
        parser.error(str(exc))
    print(f'Wrote {len(rows)} commands to {args.output}')


if __name__ == '__main__':
    main()
