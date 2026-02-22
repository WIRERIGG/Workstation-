#!/usr/bin/env python3
"""Debug script to test clang-tidy execution."""

import subprocess
from pathlib import Path

def test_clang_tidy():
    project_root = Path("/IdeaProjects/wire_ground")
    file_path = "src/demo.cpp"
    full_path = project_root / file_path
    
    cmd = [
        "/usr/bin/clang-tidy",
        "--checks=readability-*,performance-*,modernize-*",
        "--format-style=file",
        "--export-fixes=-",
        str(full_path),
        "--",
        "-I/usr/include",
        "-I/usr/include/c++/12"
    ]
    
    print("Command:", ' '.join(cmd))
    print("-" * 50)
    
    result = subprocess.run(cmd, capture_output=True, text=True, cwd=project_root)
    
    print(f"Return code: {result.returncode}")
    print(f"STDOUT length: {len(result.stdout)}")
    print(f"STDERR length: {len(result.stderr)}")
    print("-" * 50)
    
    print("STDERR (first 1000 chars):")
    print(result.stderr[:1000])
    print("-" * 50)
    
    print("STDOUT (first 500 chars):")
    print(result.stdout[:500])
    
    # Parse warnings
    warnings_found = []
    lines = result.stderr.split('\n')
    for line in lines:
        if file_path in line and ('warning:' in line or 'error:' in line):
            warnings_found.append(line)
    
    print(f"\nFound {len(warnings_found)} warnings:")
    for w in warnings_found:
        print(f"  {w}")

if __name__ == "__main__":
    test_clang_tidy()