import * as fs from 'fs';
import * as yaml from 'js-yaml';

export class ConfigLoader {
  constructor(configPath) {
    const fileContents = fs.readFileSync(configPath, 'utf8');
    this.config = yaml.load(fileContents);
  }
  
  get(key) {
    return this.config[key];
  }
}