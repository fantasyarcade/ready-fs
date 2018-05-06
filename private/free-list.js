module.exports = class FreeList {
    static writeInitial(disk, startBlock) {
        const length = calculateFreeListSize(disk.blockSize, disk.blockCount);
        const entriesPerBlock = disk.blockSize * 8;
        
        // Initial occupied blocks:
        //   - all blocks before free list start block
        //   - free list itself
        //   - root directory
        const initialOccupiedBlocks = startBlock + length + 1;

        const loadedBlock = { index: -1, data: null }
        for (let i = 0; i < disk.blockCount; ++i) {
            const occupied = i < initialOccupiedBlocks;
            const block = startBlock + Math.floor(i / entriesPerBlock);
            if (block !== loadedBlock.index) {
                _saveLoadedBlock();
                loadedBlock.index = block;
                loadedBlock.data = disk.readBlock(block);
                loadedBlock.data.fill(0xFF);
            }
            if (occupied) {
                const inBlock = i % entriesPerBlock;
                const byte = Math.floor(inBlock / 8);
                const bit = Math.floor(inBlock % 8);    
                loadedBlock.data[byte] &= ~(1 << bit);
            }
        }

        _saveLoadedBlock();

        return initialOccupiedBlocks - 1;

        function _saveLoadedBlock() {
            if (loadedBlock.index >= 0) {
                disk.writeBlock(loadedBlock.index, loadedBlock.data);
            }    
        }
    }

    constructor(disk, startBlock) {
        this.blockOffset = startBlock;
        this.blockLength = calculateFreeListSize(disk.blockSize, disk.blockCount);

        this._entriesPerBlock = disk.blockSize * 8;
        this._disk = disk;
        this._list = [];

        this._loadFreeListFromDisk();
    }

    alloc() {
        if (this._list.length === 0) {
            return -1;
        } else {
            const block = this._list.pop();
            this._markBlock(block, false);
            return block;
        }
    }

    free(block) {
        this._list.push(block);
        this._markBlock(block, true);
    }

    _loadFreeListFromDisk() {
        const loadedBlock = {index: -1, data: null};
        for (let i = 0; i < this._disk.blockCount; ++i) {
            const flb = this.blockOffset + Math.floor(i / this._entriesPerBlock);
            const flbb = i % this._entriesPerBlock;
            const byte = Math.floor(flbb / 8);
            const bit = flbb % 8;
            if (flb !== loadedBlock.index) {
                loadedBlock.index = flb;
                loadedBlock.data = this._disk.readBlock(flb);
            }
            if (loadedBlock.data[byte] & (1 << bit)) {
                this._list.unshift(i);
            }
        }
    }

    _markBlock(blockNumber, free) {
        const flb = this.blockOffset + Math.floor(blockNumber / this._entriesPerBlock);
        const flbb = blockNumber % this._entriesPerBlock;
        const byte = Math.floor(flbb / 8);
        const bit = flbb % 8;
        const blockData = this._disk.readBlock(flb);
        if (free) {
            blockData[byte] |= (1 << bit);
        } else {
            blockData[byte] &= ~(1 << bit);
        }
        this._disk.writeBlock(flb, blockData);
    }
}

function calculateFreeListSize(blockSize, blockCount) {
    return Math.ceil((blockCount / 8) / blockSize);
}