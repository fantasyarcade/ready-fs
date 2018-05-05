module.exports = class FreeList {
    static writeInitial(disk, startBlock) {
        const length = calculateFreeListSize(disk.blockSize, disk.blockCount);
        
        // We assume that all blocks before the freelist are occupied
        const initialOccupiedBlocks = startBlock + length;

        for (let i = 0; i < length; ++i) {
            const thisBlock = new Uint8Array(disk.blockSize);
            thisBlock.fill(0xFF);
            // TODO: populate
            disk.writeBlock(startBlock + i, thisBlock);
        }
        
        return startBlock + length;
    }

    constructor(disk, startBlock) {
        this.blockOffset = startBlock;
        this.blockLength = calculateFreeListSize(disk.blockSize, disk.blockCount);

        this._disk = disk;
        this._list = [];

        this._loadFreeListFromDisk();
    }

    alloc() {
        if (this._list.length === 0) {
            return -1;
        } else {
            const block = this._list.pop();
            this._markBlockAsAllocated(block);
            return block;
        }
    }

    free(block) {
        this._list.push(block);
        this._markBlockAsFree(block);
    }

    _loadFreeListFromDisk() {
        const end = this.blockOffset + this.blockLength;
        for (let i = this.blockOffset; i < end; ++i) {

        }
    }

    _markBlockAsAllocated(block) {
        const bit = block % 8;
    }

    _markBlockAsFree(block) {

    }
}

function calculateFreeListSize(blockSize, blockCount) {
    return Math.ceil((blockCount / 8) / blockSize);
}