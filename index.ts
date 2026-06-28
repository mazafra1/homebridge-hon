import { API } from 'homebridge';
import { PLATFORM_NAME, PLUGIN_NAME } from './settings';
import { HonPlatform } from './platform';

/**
 * This is the entry point for the Homebridge plugin.
 * Homebridge calls this function with its API object when it loads the plugin.
 */
export = (api: API): void => {
  api.registerPlatform(PLUGIN_NAME, PLATFORM_NAME, HonPlatform);
};
