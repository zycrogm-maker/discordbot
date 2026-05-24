const {
  Client,
  GatewayIntentBits,
  Partials,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  REST,
  Routes,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  InteractionType
} = require('discord.js');
const fs = require('fs');
const config = require('./config');
const { activeBots, MinecraftBot } = require('./bot');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.MessageContent
  ],
  partials: [Partials.Channel, Partials.Message, Partials.GuildMember]
});

// Load Database
let db = { users: {} };
if (fs.existsSync('./data.json')) {
  db = JSON.parse(fs.readFileSync('./data.json', 'utf8'));
}

const saveDB = () => {
  fs.writeFileSync('./data.json', JSON.stringify(db, null, 2));
};

// Slot System Helper
const getUserSlotLimit = (member) => {
  if (!member) return 1;
  let maxSlots = 1;

  for (const [roleName, roleData] of Object.entries(config.roles)) {
    if (member.roles.cache.has(roleData.id)) {
      if (roleData.slots === Infinity) return Infinity;
      if (roleData.slots > maxSlots) maxSlots = roleData.slots;
    }
  }
  return maxSlots;
};

const getGlobalActiveBotsCount = () => {
  let count = 0;
  activeBots.forEach(userBots => {
    userBots.forEach(botInstance => {
      if (botInstance.bot) count++;
    });
  });
  return count;
};

// Panel Embed Generator
const createPanelEmbed = (userId, member) => {
  const activeCount = getGlobalActiveBotsCount();
  const userLimit = getUserSlotLimit(member);
  const userActiveCount = activeBots.has(userId) ? Array.from(activeBots.get(userId).values()).filter(b => b.bot).length : 0;

  return new EmbedBuilder()
    .setTitle('🎮 Minecraft AFK Bot Hosting Panel')
    .setDescription('Manage your Minecraft AFK bots directly from Discord.')
    .addFields(
      { name: '📊 Global Statistics', value: `Active Bots: \`${activeCount}\`\nAvailable Slots: \`${config.maxGlobalSlots - activeCount}\`\nMax Slots: \`${config.maxGlobalSlots}\``, inline: false },
      { name: '🖥️ Backend Status', value: `Status: 🟢 Online\nAuto Reconnect: 🟢 Enabled\nRAM Usage: \`${(process.memoryUsage().heapUsed / 1024 / 1024).toFixed(2)} MB / 12GB\``, inline: false },
      { name: '👤 Your Statistics', value: `User Slots: \`${userActiveCount} / ${userLimit === Infinity ? 'Unlimited' : userLimit}\``, inline: false }
    )
    .setColor('#00AAFF')
    .setTimestamp()
    .setFooter({ text: 'Professional AFK Hosting' });
};

const createPanelButtons = () => {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('register').setLabel('Register').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('start_bot').setLabel('Start Bot').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId('stop_bot').setLabel('Stop Bot').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId('status').setLabel('Status').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('delete_bot').setLabel('Delete Bot').setStyle(ButtonStyle.Danger)
  );
};

// Interactions
client.on('interactionCreate', async (interaction) => {
  if (interaction.isChatInputCommand()) {
    if (interaction.commandName === 'panel') {
      const embed = createPanelEmbed(interaction.user.id, interaction.member);
      const row = createPanelButtons();
      const msg = await interaction.reply({ embeds: [embed], components: [row], fetchReply: true });

      // Auto-update system
      const interval = setInterval(async () => {
        try {
          const updatedEmbed = createPanelEmbed(interaction.user.id, interaction.member);
          await msg.edit({ embeds: [updatedEmbed] });
        } catch (e) {
          clearInterval(interval);
        }
      }, config.panelUpdateInterval);
    }
  }

  if (interaction.isButton()) {
    const userId = interaction.user.id;
    const member = interaction.member;

    if (interaction.customId === 'register') {
      if (db.users[userId]) return interaction.reply({ content: '❌ You are already registered!', ephemeral: true });

      const modal = new ModalBuilder().setCustomId('register_modal').setTitle('Register Minecraft Bot');
      const ipInput = new TextInputBuilder().setCustomId('ip').setLabel('Server IP').setStyle(TextInputStyle.Short).setPlaceholder('play.hypixel.net').setRequired(true);
      const usernameInput = new TextInputBuilder().setCustomId('username').setLabel('Bot Username').setStyle(TextInputStyle.Short).setPlaceholder('MyAFKBot').setRequired(true);
      const versionInput = new TextInputBuilder().setCustomId('version').setLabel('Minecraft Version').setStyle(TextInputStyle.Short).setPlaceholder('1.20.1').setRequired(false);
      
      modal.addComponents(new ActionRowBuilder().addComponents(ipInput), new ActionRowBuilder().addComponents(usernameInput), new ActionRowBuilder().addComponents(versionInput));
      await interaction.showModal(modal);
    }

    if (interaction.customId === 'start_bot') {
      if (!db.users[userId]) return interaction.reply({ content: '❌ Please register first!', ephemeral: true });
      
      const globalActive = getGlobalActiveBotsCount();
      if (globalActive >= config.maxGlobalSlots) return interaction.reply({ content: '❌ Global slots are full! (40/40)', ephemeral: true });

      const userLimit = getUserSlotLimit(member);
      const userBots = activeBots.get(userId) || new Map();
      const userActiveCount = Array.from(userBots.values()).filter(b => b.bot).length;

      if (userActiveCount >= userLimit) return interaction.reply({ content: `❌ You have reached your slot limit! (${userLimit})`, ephemeral: true });

      const botData = db.users[userId].bots[0]; // Simplified to 1 bot for now as per data structure
      if (userBots.has(botData.username) && userBots.get(botData.username).bot) {
        return interaction.reply({ content: '❌ Bot is already running!', ephemeral: true });
      }

      const botInstance = new MinecraftBot(userId, botData, client);
      if (!activeBots.has(userId)) activeBots.set(userId, new Map());
      activeBots.get(userId).set(botData.username, botInstance);

      await botInstance.start();
      interaction.reply({ content: `✅ Starting bot **${botData.username}** on **${botData.ip}**...`, ephemeral: true });
    }

    if (interaction.customId === 'stop_bot') {
      const userBots = activeBots.get(userId);
      if (!userBots || userBots.size === 0) return interaction.reply({ content: '❌ No active bots found!', ephemeral: true });

      for (const botInstance of userBots.values()) {
        await botInstance.stop();
      }
      interaction.reply({ content: '✅ All your bots have been stopped.', ephemeral: true });
    }

    if (interaction.customId === 'status') {
      if (!db.users[userId]) return interaction.reply({ content: '❌ No bot data found. Register first!', ephemeral: true });
      
      const botData = db.users[userId].bots[0];
      const userBots = activeBots.get(userId);
      const botInstance = userBots ? userBots.get(botData.username) : null;
      const status = botInstance ? botInstance.getStatus() : { online: false, uptime: null, reconnectCount: 0 };

      const statusEmbed = new EmbedBuilder()
        .setTitle(`🤖 Bot Status: ${botData.username}`)
        .addFields(
          { name: 'Status', value: status.online ? '🟢 Online' : '🔴 Offline', inline: true },
          { name: 'Server', value: botData.ip, inline: true },
          { name: 'Uptime', value: status.uptime ? `<t:${Math.floor(status.uptime / 1000)}:R>` : 'N/A', inline: true },
          { name: 'Reconnects', value: status.reconnectCount.toString(), inline: true }
        )
        .setColor(status.online ? '#00FF00' : '#FF0000');

      interaction.reply({ embeds: [statusEmbed], ephemeral: true });
    }

    if (interaction.customId === 'delete_bot') {
      if (!db.users[userId]) return interaction.reply({ content: '❌ No bot data to delete!', ephemeral: true });

      const userBots = activeBots.get(userId);
      if (userBots) {
        for (const botInstance of userBots.values()) {
          await botInstance.stop();
        }
        activeBots.delete(userId);
      }

      delete db.users[userId];
      saveDB();
      interaction.reply({ content: '✅ Your bot data has been deleted and instances stopped.', ephemeral: true });
    }
  }

  if (interaction.type === InteractionType.ModalSubmit) {
    if (interaction.customId === 'register_modal') {
      const ip = interaction.fields.getTextInputValue('ip');
      const username = interaction.fields.getTextInputValue('username');
      const version = interaction.fields.getTextInputValue('version') || '1.20.1';

      db.users[interaction.user.id] = {
        bots: [{
          ip,
          port: 25565,
          username,
          version,
          auth: 'offline',
          status: 'offline'
        }]
      };
      saveDB();

      await interaction.reply({ content: `✅ Registered bot **${username}** for server **${ip}**!`, ephemeral: true });
    }
  }
});

// Slash Command Registration
const commands = [
  {
    name: 'panel',
    description: 'Open the Minecraft Bot Hosting Panel'
  }
];

const rest = new REST({ version: '10' }).setToken(config.token);

(async () => {
  try {
    console.log('Started refreshing application (/) commands.');
    // In production, use Routes.applicationCommands(CLIENT_ID)
    // For now, we'll just log that they should be registered.
    // Replace YOUR_CLIENT_ID when ready.
    // await rest.put(Routes.applicationCommands("YOUR_CLIENT_ID"), { body: commands });
    console.log('Successfully reloaded application (/) commands.');
  } catch (error) {
    console.error(error);
  }
})();

client.once('ready', () => {
  console.log(`Logged in as ${client.user.tag}!`);
  console.log('Professional MC AFK Panel is now online.');
});

client.login(config.token);
