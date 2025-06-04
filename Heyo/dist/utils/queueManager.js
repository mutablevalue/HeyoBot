"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.QueueManager = void 0;
const promises_1 = require("timers/promises");
class QueueManager {
    constructor(maxSize, workerCount, retryDelay) {
        this.queue = [];
        this.processing = false;
        this.maxSize = maxSize;
        this.workerCount = workerCount;
        this.retryDelay = retryDelay;
    }
    async startWorkers(workerFn) {
        if (this.processing)
            return;
        this.processing = true;
        for (let i = 0; i < this.workerCount; i++) {
            this.workerLoop(workerFn);
        }
        console.log(`Started ${this.workerCount} queue workers.`);
    }
    async workerLoop(workerFn) {
        while (this.processing) {
            const item = this.dequeue();
            if (item === undefined) {
                await (0, promises_1.setTimeout)(100); // pause before checking again
                continue;
            }
            try {
                await workerFn(item);
            }
            catch (err) {
                console.error(`Error processing item: ${err}`);
                await (0, promises_1.setTimeout)(this.retryDelay * 1000);
                this.enqueue(item);
            }
        }
    }
    stopWorkers() {
        this.processing = false;
        console.log('Stopped all queue workers.');
    }
    enqueue(item) {
        if (this.maxSize > 0 && this.queue.length >= this.maxSize) {
            console.warn('Queue is full, cannot enqueue item.');
            return false;
        }
        this.queue.push(item);
        console.debug(`Enqueued item: ${item}`);
        return true;
    }
    dequeue() {
        return this.queue.shift();
    }
}
exports.QueueManager = QueueManager;
