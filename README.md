# ready-fs

Disk filesystem for [READY](https://fantasyarca.de/ready/).

# Overview

File system has:
  
  - Free list (bitmap)
  - Root directory

# Inode format

Each inode is a list of pointers to disk blocks. A pointer is 16 bits, so a disk has a maximum of 65536 blocks. The scheme is similar to Linux: pointers in the first half of a file's root inode are direct data pointers, whereas those in the second half have a single level of indirection.

Given a 512 byte block size:

```
Number of pointers per inode        : 256 (512 bytes / 2 bytes)
Number of direct pointers (root)    : 128
Directly addressable data           : 65536 bytes (128 * 512 bytes)
Number of indirect pointers (root)  : 128
Indirectly addressable data         : 16777216 bytes (128 * 256 * 512 bytes)
Maximum file size                   : 16MiB + 64KiB
```

# Directory Format

Each directory entry is 32 bytes. Filenames do not have extensions, instead there's a dedicated type field to specify a file's type.

```
Field                   Offset      Length      Notes
-------------------------------------------------------------------------
filename                0           16          0x00 at 0 => empty record
type                    16          2           0x00 => directory
data inode              18          2           0x00 => no data
metadata inode          20          2           0x00 => no metadata
modified date           22          4           Stored as UTC
size                    26          4
flags                   30          2
```

A non-zero item in the final position of a directory block is a continuation pointer.