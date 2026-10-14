"""
Cleanup script for backend/var/storage/

Removes all uploaded dataset CSV files and their analysis metadata.

WARNING: This will permanently delete all stored datasets.
Use only when you want to clear all user-uploaded data.

Usage:
    python cleanup_storage.py       # Remove everything in var/storage/
    python cleanup_storage.py --dry-run  # Show what would be removed without deleting
"""

import os
import sys
import argparse
from pathlib import Path

STORAGE_DIR = Path("var/storage")


def get_all_files(storage_dir: Path) -> list[Path]:
    """Get all files in storage directory recursively."""
    files = []
    if storage_dir.exists():
        for root, _dirs, filenames in os.walk(storage_dir):
            for f in filenames:
                files.append(Path(root) / f)
    return files


def remove_files(files: list[Path], dry_run: bool = False) -> None:
    """Remove or list files with their size."""
    for file_path in files:
        try:
            size = file_path.stat().st_size
            if dry_run:
                print(f"[DRY-RUN] Would remove: {file_path} ({size:,} bytes)")
            else:
                file_path.unlink()
                print(f"Removed: {file_path.name} ({size:,} bytes)")
        except FileNotFoundError:
            print(f"Already removed (not found): {file_path}")
        except Exception as e:
            print(f"Error removing {file_path}: {e}")


def main() -> None:
    parser = argparse.ArgumentParser(description="Cleanup var/storage dataset files")
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Show files that would be removed without actually deleting them",
    )
    parser.add_argument(
        "--force",
        action="store_true",
        help="Skip confirmation prompt (use with --dry-run for preview)",
    )
    
    args = parser.parse_args()
    
    if not STORAGE_DIR.exists():
        print(f"Storage directory not found: {STORAGE_DIR}")
        sys.exit(0)
    
    files = get_all_files(STORAGE_DIR)
    
    if not files:
        print("No files found in var/storage/")
        sys.exit(0)
    
    total_size = sum(f.stat().st_size for f in files)
    
    print(f"Found {len(files)} files in var/storage/")
    print(f"Total size: {total_size:,} bytes ({total_size / 1024 / 1024:.2f} MB)")
    
    if not args.dry_run and not args.force:
        confirm = input(
            f"Are you sure you want to delete all {len(files)} files "
            f"and clear var/storage/? [y/N]: "
        )
        if confirm.lower() != "y":
            print("Aborted. No files deleted.")
            sys.exit(0)
    
    remove_files(files, dry_run=args.dry_run)
    
    if not args.dry_run:
        print(f"\nvar/storage/ has been cleared.")
        # Recreate empty directory
        STORAGE_DIR.mkdir(parents=True, exist_ok=True)
        print("Empty var/storage/ directory recreated.")


if __name__ == "__main__":
    main()
