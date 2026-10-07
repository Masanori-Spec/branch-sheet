import { defineConfig } from '@playwright/test';
export default defineConfig({ testDir:'./tests/browser', timeout:180000, workers:1, fullyParallel:false, retries:0, reporter:[['list'],['html',{open:'never'}]], use:{ headless:true, viewport:{width:1365,height:950}, launchOptions:{chromiumSandbox:true} } });
