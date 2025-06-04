import * as fs from 'fs';
import * as yaml from 'js-yaml';

export class ConfigLoader {
  private config: any;
  
  constructor(configPath: string) {
    const fileContents = fs.readFileSync(configPath, 'utf8');
    this.config = yaml.load(fileContents);
  }
  
  get(key: string): any {
    return this.config[key];
  }
}