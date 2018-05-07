const {
    basename,
    dirname
} = require('path');

const {
    readFixedLengthAsciiString,
    writeFixedLengthAsciiString,
    readUint16BE,
    readUint32BE,
    writeUint16BE,
    writeUint32BE
} = require('@fantasyarcade/uint8array-utils');

const FreeList = require('./private/free-list');

// TODO: extract this to a module
const Types = {
    Directory: 0x0000
}

exports.create = function(disk) {
    // TODO: set filesystem version on disk (need a method disk to do this)
    const rootDirBlock = FreeList.writeInitial(disk, 1); // create initial freelist
    disk.writeBlock(rootDirBlock, new Uint8Array(disk.blockSize)); // zero-out root directory
    return new FileSystem(disk);
}

exports.open = function(disk) {
    // TODO: read filesystem type/version from disk + check valid
    return new FileSystem(disk);
}

class FileSystem {
    constructor(disk) {
        this._disk = disk;
        this._freelist = new FreeList(disk, 1);
        this._rootDirectoryOffset = this._freelist.blockOffset + this._freelist.blockLength;
    }

    list(directory) {
        let block = this._findBlockForDirectory(directory);
        if (block === -1) {
            // TODO: set error
            return false;
        }
        const files = [];
        this._walkDirectoryEntries(block, false, (blockNumber, blockData, entryOffset) => {
            files.push(parseDirectoryEntry(blockData, entryOffset));
        });
        return files;
    }

    create(path, type) {
        if (type === Types.Directory) {
            // TODO: set error
            return false;
        }

        const res = this._prepareNewDirectoryEntry(path, type);
        if (res === false) {
            return false;
        }

        const [block, offset, data] = res;
        this._disk.writeBlock(block, data);

        return true;
    }

    delete(path) {
        const dirBlock = this._findBlockForDirectory(dirname(path));
        if (dirBlock < 0) {
            // TODO: set error
            return false;
        }

        const victim = basename(path);
        let state = 0;

        this._walkDirectoryEntries(dirBlock, false, (b, d, o) => {
            if (readFilename(d, o) === victim) {
                if (readType(d, o) === Types.Directory) {
                    state = 1;
                } else {
                    this._purgeInode(readDataPointer(d, o));
                    // TODO: zap metadata, when we have metadata
                    clearDirectoryEntry(d, o);
                    this._disk.writeBlock(b, d);
                    state = 2;
                }
                return false;
            }
        });

        switch (state) {
            case 0: // not found
                // TODO: set error
                return false;
            case 1: // directory
                // TODO: set error
                return false;
            case 2:
                return true;
        }
    }

    mkdir(path) {
        const newDirBlock = this._freelist.alloc();
        if (newDirBlock < 0) {
            // TODO: set error
            return false;
        }

        const res = this._prepareNewDirectoryEntry(path, Types.Directory);
        if (res === false) {
            this._freelist.free(newDirBlock);
            return false;
        }

        this._disk.zeroBlock(newDirBlock);

        const [block, offset, data] = res;
        writeDataPointer(data, offset, newDirBlock);
        this._disk.writeBlock(block, data);

        return true;
    }

    rmdir(path) {
        const parentInfo = {};
        const dirBlock = this._findBlockForDirectory(path, parentInfo);
        if (dirBlock < 0) {
            // TODO: set error
            return false;
        }

        // Check directory empty
        let empty = true;
        this._walkDirectoryEntries(dirBlock, false, (b, d, o) => {
            empty = false;
            return false;
        });

        if (!empty) {
            // TODO: set error
            return false;
        }

        // Reclaim all directory blocks
        let victimBlock = dirBlock;
        while (victimBlock) {
            const vbd = this._disk.readBlock(victimBlock);
            this._freelist.free(victimBlock);
            victimBlock = readUint16BE(vbd[this._disk.blockSize - 32]);
        }

        // Remove directory entry
        const parentBlock = this._disk.readBlock(parentInfo.block);
        clearDirectoryEntry(parentBlock, parentInfo.offset);
        this._disk.writeBlock(parentInfo.block, parentBlock);

        return true;
    }

    _prepareNewDirectoryEntry(path, type) {
        let dirBlock = this._findBlockForDirectory(dirname(path));
        if (dirBlock === -1) {
            // TODO: set error
            return false;
        }

        let alreadyExists = false, freeBlock = -1, freeOffset;

        const lastBlock = this._walkDirectoryEntries(dirBlock, true, (blockNumber, blockData, entryOffset) => {
            if (blockData[entryOffset] === 0) {
                if (freeBlock < 0) {
                    freeBlock = blockNumber;
                    freeOffset = entryOffset;   
                }
            } else {
                const filename = readFilename(blockData, entryOffset);
                if (filename === basename(path)) {
                    alreadyExists = true;
                    return false;
                }
            }
        });

        if (alreadyExists) {
            // TODO: set error
            return false;
        }

        if (freeBlock < 0) {
            console.log("I will allocate a new directory block...");
            // TODO: try to allocate a block from the free list here
            // set up continuation pointer from previous block etc.
            return false;
        }

        const blockData = this._createEmptyFileInDirectory(
            freeBlock,
            freeOffset,
            basename(path),
            type
        );

        return [freeBlock, freeOffset, blockData];
    }

    _findBlockForDirectory(path, parentInfo) {
        let block = this._rootDirectoryOffset;
        if (parentInfo) {
            parentInfo.startBlock = null;
            parentInfo.block = null;
            parentInfo.offset = null;
        }
        const components = path.replace(/\/+$/, '').split(/\/+/);
        for (let i = 1; i < components.length; ++i) {
            let nextBlock = -1;
            this._walkDirectoryEntries(block, false, (b, d, o) => {
                if (readFilename(d, o) === components[i]) {
                    if (readType(d, o) === Types.Directory) {
                        nextBlock = readDataPointer(d, o);
                        if (parentInfo) {
                            parentInfo.startBlock = block;
                            parentInfo.block = b;
                            parentInfo.offset = o;
                        }
                    }
                    return false;
                }
            });
            if (nextBlock < 0) {
                return -1;
            } else {
                block = nextBlock;
            }
        }
        return block;
    }

    _walkDirectoryEntries(block, includeBlank, cb) {
        while (true) {
            const blockData = this._disk.readBlock(block);
            const end = this._disk.blockSize - 32;
            let i;
            for (i = 0; i < end; i += 32) {
                if (!includeBlank && blockData[i] === 0) {
                    continue;
                }
                if (cb(block, blockData, i) === false) {
                    return block;
                }
            }
            const nextBlock = readUint16BE(blockData, i);
            if (nextBlock === 0) {
                return block;
            } else {
                block = nextBlock;
            }
        }
    }

    _createEmptyFileInDirectory(block, offset, name, type) {
        const data = this._disk.readBlock(block);
        writeFixedLengthAsciiString(data, offset + 0, 16, name);
        writeUint16BE(data, offset + 16, type);
        writeUint16BE(data, offset + 18, 0);
        writeUint16BE(data, offset + 20, 0);
        writeUint32BE(data, offset + 22, Math.floor(Date.now() / 1000));
        writeUint32BE(data, offset + 26, 0);
        writeUint16BE(data, offset + 30, 0);
        return data;
    }

    _purgeInode(block) {
        const end = this._disk.blockSize - 2;
        while (block) {
            const blockData = this._disk.readBlock(block);
            let i;
            for (i = 0; i < end; i += 2) {
                const b = readUint16BE(blockData, i);
                if (b !== 0) {
                    this._freelist.free(b);
                }
            }
            block = readUint16BE(blockData, i);
        }
    }
}

function readFilename(data, offset) { return readFixedLengthAsciiString(data, offset, 16); }
function readType(data, offset) { return readUint16BE(data, offset + 16); }
function readDataPointer(data, offset) { return readUint16BE(data, offset + 18); }
function readMetadataPointer(data, offset) { return readUint16BE(data, offset + 20); }

function writeDataPointer(data, offset, value) { writeUint16BE(data, offset + 18, value); }

function clearDirectoryEntry(data, offset) {
    const end = offset + 32;
    while (offset < end) {
        data[offset++] = 0;
    }
}

function parseDirectoryEntry(data, offset) {
    return {
        name        : readFilename(data, offset),
        type        : readUint16BE(data, offset + 16),
        dataInode   : readUint16BE(data, offset + 18),
        metaInode   : readUint16BE(data, offset + 20),
        modified    : readUint32BE(data, offset + 22),
        size        : readUint32BE(data, offset + 26),
        flags       : readUint16BE(data, offset + 30)
    };
}
