// Jest setup provided by Grafana scaffolding
import './.config/jest-setup';

// React's scheduler keeps a MessageChannel open under Node 24 + jsdom, which stops Jest
// from exiting. Without MessageChannel it falls back to setTimeout.
delete global.MessageChannel;
