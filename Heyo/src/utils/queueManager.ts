import { setTimeout as wait } from 'timers/promises';

export type WorkerFunction<T> = (item: T) => Promise<void>;

export class QueueManager<T> {
  private queue: T[] = [];
  private maxSize: number;
  private workerCount: number;
  private retryDelay: number;
  private processing = false;

  constructor(maxSize: number, workerCount: number, retryDelay: number) {
    this.maxSize = maxSize;
    this.workerCount = workerCount;
    this.retryDelay = retryDelay;
  }

  public async startWorkers(workerFn: WorkerFunction<T>): Promise<void> {
    if (this.processing) return;
    this.processing = true;
    for (let i = 0; i < this.workerCount; i++) {
      this.workerLoop(workerFn);
    }
    console.log(`Started ${this.workerCount} queue workers.`);
  }

  private async workerLoop(workerFn: WorkerFunction<T>): Promise<void> {
    while (this.processing) {
      const item = this.dequeue();
      if (item === undefined) {
        await wait(100); // pause before checking again
        continue;
      }
      try {
        await workerFn(item);
      } catch (err) {
        console.error(`Error processing item: ${err}`);
        await wait(this.retryDelay * 1000);
        this.enqueue(item);
      }
    }
  }

  public stopWorkers(): void {
    this.processing = false;
    console.log('Stopped all queue workers.');
  }

  public enqueue(item: T): boolean {
    if (this.maxSize > 0 && this.queue.length >= this.maxSize) {
      console.warn('Queue is full, cannot enqueue item.');
      return false;
    }
    this.queue.push(item);
    console.debug(`Enqueued item: ${item}`);
    return true;
  }

  private dequeue(): T | undefined {
    return this.queue.shift();
  }
}