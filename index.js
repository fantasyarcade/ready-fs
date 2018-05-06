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

        this._createEmptyFileInDirectory(freeBlock, freeOffset, basename(path), type);

        return true;
    }

    _findBlockForDirectory(path) {
        let block = this._rootDirectoryOffset;
        const components = path.replace(/\/+$/, '').split(/\/+/);
        for (let i = 1; i < components.length; ++i) {
            let nextBlock = -1;
            this._walkDirectoryEntries(block, false, (b, d, o) => {
                if (readFilename(d, o) === components[i]) {
                    if (readType(d, o) === Types.Directory) {
                        nextBlock = readDataPointer(d, o);
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
        this._disk.writeBlock(block, data);
    }
}

function readFilename(data, offset) { return readFixedLengthAsciiString(data, offset, 16); }
function readType(data, offset) { return readUint16BE(data, offset + 16); }
function readDataPointer(data, offset) { return readUint16BE(data, offset + 18); }

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
