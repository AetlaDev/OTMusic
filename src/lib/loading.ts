 

type TaskName = string;

class LoadingGate {
  private pending = new Set<TaskName>();
  private _ready = false;
  private resolveReady!: () => void;
  private readyPromise = new Promise<void>((res) => {
    this.resolveReady = res;
  });

   
  get isReady(): boolean {
    return this._ready;
  }

   
  get ready(): Promise<void> {
    return this.readyPromise;
  }

   
  start(name: TaskName): void {
    if (this._ready) return;
    this.pending.add(name);
  }

   
  done(name: TaskName): void {
    if (this._ready) return;
    this.pending.delete(name);
    if (this.pending.size === 0) {
      this._ready = true;
      this.resolveReady();
    }
  }

   
  waitFor(name: TaskName, task: Promise<unknown>): void {
    if (this._ready) return;
    this.pending.add(name);
    task.then(
      () => this.done(name),
      () => this.done(name)
    );
  }
}

export const pageLoad = new LoadingGate();
