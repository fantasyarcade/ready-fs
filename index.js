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
        this._rootDirectoryBlock = this._freelist.blockOffset + this._freelist.blockLength;
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

        if (!this._insertNewDirectoryEntry(path, type, 0)) {
            return false;
        }

        return true;
    }

    mkdir(path) {
        const newDirBlock = this._freelist.alloc();
        if (newDirBlock < 0) {
            // TODO: set error
            return false;
        }

        this._disk.zeroBlock(newDirBlock);

        if (!this._insertNewDirectoryEntry(path, Types.Directory, newDirBlock)) {
            this._freelist.free(newDirBlock);
            return false;
        }

        return true;
    }

    delete(path) {
        const res = this._removeDirectoryEntry(path, false);
        if (!res) {
            // TODO: set error
            return false;
        }

        const [dataPointer, metadataPointer] = res;

        // TODO: purge inode if file is not open
        // this._purgeInode(dataPointer);

        return true;
    }

    rmdir(path) {
        const res = this._removeDirectoryEntry(path, true);
        if (!res) {
            // TODO: set error
            return false;
        }

        const [dataPointer, metadataPointer] = res;

        // Reclaim all directory blocks
        let victimBlock = dataPointer;
        while (victimBlock) {
            const vbd = this._disk.readBlock(victimBlock);
            this._freelist.free(victimBlock);
            victimBlock = readUint16BE(vbd, this._disk.blockSize - 32);
        }

        return true;
    }

    setType(path, newType) {
        if (newType === Types.Directory) {
            // TODO: set error
            return false;
        }

        // TODO: valid newType is Uint16

        const entry = this._findDirectoryEntryForPath(path);
        if (!entry) {
            // TODO: set error
            return false;
        }

        const [block, data, offset] = entry;
        
        if (readType(data, offset) === Types.Directory) {
            // TODO: set error
            return false;
        }

        writeType(data, offset, newType);
        this._disk.writeBlock(block, data);

        return true;
    }

    _removeDirectoryEntry(path, deletingDirectory) {
        const dir = dirname(path);

        let pb = null, pd, po;
        let dirBlock;

        if (dir !== '/') {

            // Find the target directory's record in its parent directory
            const parentEntry = this._findDirectoryEntryForPath(dir);
            if (parentEntry === false) {
                // TODO: set error
                return false;
            }

            [pb, pd, po] = parentEntry;

            // Check that it's a directory
            if (!isDirectory(pd, po)) {
                // TODO: set error
                return false;
            }

            // Read its data pointer
            dirBlock = readDataPointer(pd, po);

        } else {
            dirBlock = this._findBlockForDirectory(dir);
            if (dirBlock < 0) {
                // TODO: set error
                return false;
            }
        }

        const victim = basename(path);

        let fb = null, fd, fo;

        this._walkDirectoryEntries(dirBlock, false, (b, d, o) => {
            if (readFilename(d, o) === victim) {
                fb = b;
                fd = d;
                fo = o;
                return false;
            }
        });

        if (fb === null) {
            // TODO: set error
            return false;
        }

        if (deletingDirectory) {
            if (!isDirectory(fd, fo)) {
                // TODO: set error
                return false;
            }

            let empty = true;
            this._walkDirectoryEntries(readDataPointer(fd, fo), false, (b, d, o) => {
                empty = false;
                return false;
            });

            if (!empty) {
                // TODO: set error
                return false;
            }
        } else if (isDirectory(fd, fo)) {
            // TODO: set error
            return false;
        }

        clearDirectoryEntry(fd, fo);
        this._disk.writeBlock(fb, fd);

        // Decrement parent directory size if not in root directory
        if (pb !== null) {
            writeSize(pd, po, readSize(pd, po) - 1);
            this._disk.writeBlock(pb, pd);
        }
    }

    _insertNewDirectoryEntry(path, type, dataPointer) {
        const dir = dirname(path);

        let pb = null, pd, po;
        let dirBlock;

        // If we're not in the root directory we need to grab the parent
        // directory's record for the target dir so we can update the size
        // (i.e. # of files). We don't store this data for the root directory.
        if (dir !== '/') {

            // Find the target directory's record in its parent directory
            const parentEntry = this._findDirectoryEntryForPath(dir);
            if (parentEntry === false) {
                // TODO: set error
                return false;
            }

            [pb, pd, po] = parentEntry;

            // Check that it's a directory
            if (!isDirectory(pd, po)) {
                // TODO: set error
                return false;
            }

            // Read its data pointer
            dirBlock = readDataPointer(pd, po);

        } else {
            dirBlock = this._findBlockForDirectory(dir);
            if (dirBlock < 0) {
                // TODO: set error
                return false;
            }
        }

        // Walk the target directory to:
        // a) find space
        // b) check no file with same name
        let alreadyExists = false, fb = -1, fd, fo;
        const lastBlock = this._walkDirectoryEntries(dirBlock, true, (blockNumber, blockData, entryOffset) => {
            if (blockData[entryOffset] === 0) {
                if (fb < 0) {
                    fb = blockNumber;
                    fd = blockData;
                    fo = entryOffset;   
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

        if (fb < 0) {
            console.log("I will allocate a new directory block...");
            // TODO: try to allocate a block from the free list here
            // set up continuation pointer from previous block etc.
            return false;
        }

        // Populate the directory entry & write back
        // TODO: use the write* functions here
        writeFixedLengthAsciiString(fd, fo + 0, 16, basename(path));
        writeUint16BE(fd, fo + 16, type);
        writeUint16BE(fd, fo + 18, dataPointer);
        writeUint16BE(fd, fo + 20, 0);
        writeUint32BE(fd, fo + 22, Math.floor(Date.now() / 1000));
        writeUint32BE(fd, fo + 26, 0);
        writeUint16BE(fd, fo + 30, 0);
        this._disk.writeBlock(fb, fd);

        // Increment parent directory size if not in root directory
        if (pb !== null) {
            writeSize(pd, po, readSize(pd, po) + 1);
            this._disk.writeBlock(pb, pd);
        }

        return true;
    }

    _findBlockForDirectory(path) {
        if (path === '/') {
            return this._rootDirectoryBlock;
        }

        const res = this._findDirectoryEntryForPath(path);
        if (!res) {
            return -1;
        } else {
            const [block, data, offset] = res;
            if (!isDirectory(data, offset)) {
                return -1;
            } else {
                return readDataPointer(data, offset);
            }
        }
    }

    _findDirectoryEntryForPath(path) {
        let searchBlock = this._rootDirectoryBlock;
        let retVal = null;
        const components = path.replace(/\/+$/, '').split(/\/+/);
        for (let i = 1; ; ++i) {
            let nextBlock = -1;
            this._walkDirectoryEntries(searchBlock, false, (b, d, o) => {
                if (readFilename(d, o) === components[i]) {
                    if (i === components.length - 1) {
                        retVal = [b, d, o];
                    } else if (readType(d, o) !== Types.Directory) {
                        retVal = false;
                    } else {
                        nextBlock = readDataPointer(d, o);
                    }
                    return false;
                }
            });
            if (retVal !== null) {
                break;
            } else if (nextBlock < 0) {
                retVal = false;
                break;
            } else {
                searchBlock = nextBlock;
            }
        }
        return retVal;
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

function isDirectory(data, offset) { return readType(data, offset) === Types.Directory; }

function readFilename(data, offset) { return readFixedLengthAsciiString(data, offset, 16); }
function readType(data, offset) { return readUint16BE(data, offset + 16); }
function readDataPointer(data, offset) { return readUint16BE(data, offset + 18); }
function readMetadataPointer(data, offset) { return readUint16BE(data, offset + 20); }
function readSize(data, offset) { return readUint32BE(data, offset + 26); }

function writeType(data, offset, value) { writeUint16BE(data, offset + 16, value); }
function writeDataPointer(data, offset, value) { writeUint16BE(data, offset + 18, value); }
function writeSize(data, offset, value) { return writeUint32BE(data, offset + 26, value); }

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
