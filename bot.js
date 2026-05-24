const mineflayer = require('mineflayer');
const config = require('./config');
const { EmbedBuilder } = require('discord.js');

const activeBots = new Map();

class MinecraftBot {
  constructor(userId, botData, client) {
    this.userId = userId;
    this.botData = botData;
    this.client = client;
    this.bot = null;
    this.reconnectCount = 0;
    this.uptime = null;
    this.reconnectTimeout = null;
    this.isStopping = false;
  }

  async start() {
    this.isStopping = false;
    const options = {
      host: this.botData.ip,
      port: this.botData.port || 25565,
      username: this.botData.username,
      version: this.botData.version || false,
      auth: this.botData.auth === 'microsoft' ? 'microsoft' : 'offline',
    };

    try {
      this.bot = mineflayer.createBot(options);
      this.setupEvents();
      this.uptime = Date.now();
    } catch (error) {
      this.log('🔴 Error', `Failed to start bot: ${error.message}`);
    }
  }

  setupEvents() {
    this.bot.on('spawn', () => {
      this.log('🟢 Spawned', `Bot has spawned in the server.`);
      this.startAFK();
    });

    this.bot.on('login', () => {
      this.log('🟢 Connected', `Bot has logged in.`);
    });

    this.bot.on('end', (reason) => {
      if (this.isStopping) return;
      this.log('🟡 Reconnecting', `Bot disconnected: ${reason}. Retrying in ${config.reconnectDelay / 1000}s...`);
      this.handleReconnect();
    });

    this.bot.on('kicked', (reason) => {
      const kickReason = typeof reason === 'string' ? reason : JSON.stringify(reason);
      this.log('🔴 Kicked', `Bot was kicked: ${kickReason}`);
    });

    this.bot.on('error', (err) => {
      this.log('🔴 Error', `Mineflayer error: ${err.message}`);
    });
  }

  startAFK() {
    // Simple Anti-AFK: Jump every 30 seconds
    setInterval(() => {
      if (this.bot && this.bot.entity) {
        this.bot.setControlState('jump', true);
        setTimeout(() => {
          if (this.bot && this.bot.entity) this.bot.setControlState('jump', false);
        }, 500);
      }
    }, 30000);
  }

  handleReconnect() {
    if (this.reconnectTimeout) clearTimeout(this.reconnectTimeout);
    this.reconnectTimeout = setTimeout(() => {
      this.reconnectCount++;
      this.start();
    }, config.reconnectDelay);
  }

  async stop() {
    this.isStopping = true;
    if (this.reconnectTimeout) clearTimeout(this.reconnectTimeout);
    if (this.bot) {
      this.bot.quit();
      this.bot = null;
    }
    this.uptime = null;
    this.log('⚫ Stopped', `Bot has been manually stopped.`);
  }

  async restart() {
    this.log('🔵 Restart', `Restarting bot...`);
    await this.stop();
    await this.start();
  }

  async log(title, description) {
    const channel = this.client.channels.cache.get(config.botLogsChannelId);
    if (!channel) return;

    const embed = new EmbedBuilder()
      .setTitle(title)
      .setDescription(description)
      .addFields(
        { name: 'User', value: `<@${this.userId}>`, inline: true },
        { name: 'Bot Username', value: this.botData.username, inline: true },
        { name: 'Server IP', value: this.botData.ip, inline: true },
        { name: 'Reconnects', value: this.reconnectCount.toString(), inline: true },
        { name: 'Uptime', value: this.uptime ? `<t:${Math.floor(this.uptime / 1000)}:R>` : 'Offline', inline: true }
      )
      .setColor(this.getColor(title))
      .setTimestamp();

    channel.send({ embeds: [embed] });
  }

  getColor(title) {
    if (title.includes('🟢')) return '#00FF00';
    if (title.includes('🟡')) return '#FFFF00';
    if (title.includes('🔴')) return '#FF0000';
    if (title.includes('🔵')) return '#0000FF';
    return '#808080';
  }

  getStatus() {
    return {
      online: !!this.bot && !!this.bot.entity,
      username: this.botData.username,
      ip: this.botData.ip,
      uptime: this.uptime,
      reconnectCount: this.reconnectCount
    };
  }
}

module.exports = {
  activeBots,
  MinecraftBot
};
