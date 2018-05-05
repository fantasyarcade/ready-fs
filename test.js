function createDisk(blockSize, blockCount) {
    return require('@fantasyarcade/ready-memory-disk').createBlankDisk(blockSize, blockCount);
}

function createFS(blockSize, blockCount) {
    return require('./').create(createDisk(blockSize, blockCount));
}

const fs = createFS(256, 512);

for (let i = 0; i < 16; ++i) {
    console.log(fs.create("/foo" + i, 1));  
}

console.log(fs.list('/'));