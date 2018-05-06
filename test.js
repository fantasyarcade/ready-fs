function createDisk(blockSize, blockCount) {
    return require('@fantasyarcade/ready-memory-disk').createBlankDisk(blockSize, blockCount);
}

function createFS(blockSize, blockCount) {
    return require('./').create(createDisk(blockSize, blockCount));
}

const fs = createFS(256, 512);

fs.create("/foo1", 1);
fs.create("/foo2", 1);
fs.create("/foo3", 1);

fs.mkdir("/moose");
fs.mkdir("/moose/slashdot");

fs.create("/moose/bar1", 1);
fs.create("/moose/bar2", 1);
fs.create("/moose/bar3", 1);

console.log(fs.list("/moose/"));

console.log(fs.list("/moose/slashdot"));

fs.create("/moose/slashdot/toodle", 1);
fs.create("/moose/slashdot/pip", 1);

console.log(fs.list("/moose/slashdot"));

// console.log(fs._disk.readBlock(1));

// for (let i = 0; i < 16; ++i) {
//     console.log(fs.create("/foo" + i, 1));  
// }


// console.log(fs.list('/'));