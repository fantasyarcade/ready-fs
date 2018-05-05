# ready-fs

Disk filesystem for [READY](https://fantasyarca.de/ready/).

# Overview

File system has:
  
  - Free list (bitmap)
  - Root directory

# Inode format

Each 16 bit pointer is a pointer to a data block; zero is a sentinel value. If the final pointer in an inode is non-zero it's interpreted as a chain inode.

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