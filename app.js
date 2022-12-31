const { App } = require('@slack/bolt');
require('dotenv').config(); // .env読み取り用
const { execSync } = require('child_process'); // bash叩く用

const exportFolder = "./slack_export_test"; // エクスポートフォルダ名

const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  signingSecret: process.env.SLACK_SIGNING_SECRET,
  socketMode: true,
  appToken: process.env.SLACK_APP_TOKEN,
  // ソケットモードではポートをリッスンしませんが、アプリを OAuth フローに対応させる場合、
  // 何らかのポートをリッスンする必要があります
  port: process.env.PORT || 3000
});

// メッセージに反応してアクションを発火
app.message('hoge', async ({ message, say }) => {
  const channel = "C04FSRFRE7N";

  console.log("出力");

  // エクスポート対象のフォルダが無ければ作成
  var fs = require("fs");
  if(!fs.existsSync(exportFolder))
  {
    fs.mkdirSync(exportFolder);
    console.log("エクスポートフォルダを作成しました。必要なjsonファイルが存在するか確認してください");
  }

  // ユーザー情報の保存
  await writeUsersJson();

  // チャンネル情報の保存
  await writeChannelsJson();

  // チャンネルメッセージの書き出し
  await writeChannelHistoryJson(channel, "hoge");

  // 書き出し対象をzip化
  await forZip("./slack_export_test", "slack_export_test.zip");

  console.log("Export completed!!")
});

// 1.チャンネル情報の書き出し
async function writeChannelsJson()
{
  // チャンネル一覧の取得
  const response = await app.client.conversations.list();
  var channels =  response.channels;

  // 各チャンネルのメンバー情報を個別で取得
  await (async () => {
    for await (channel of channels) 
    {
      const channelId = channel.id;
      const members = await getChannelMembers(channelId);
      channel.members = members;
    }
  })();

  channels = JSON.stringify(channels);

  var fs = require("fs");
  const filePath = exportFolder + "/channels.json";

  // jsonファイルの書き出し
  try
  {
    fs.writeFileSync(filePath, channels);
  }
  catch(e)
  {
    console.log(e);
  }

  return new Promise((resolve, reject) => {
    resolve("success");
    });
}

// 2.チャンネル参加メンバーを取得
async function getChannelMembers(channelId)
{
  const response = await app.client.conversations.members({
    channel: channelId
  });

  return new Promise((resolve, reject) => {
    resolve(response.members);
    });
}

// ユーザー一覧の書き出し
async function writeUsersJson()
{
  const response = await app.client.users.list();
  var users = response.members;
  users = JSON.stringify(users);

  var fs = require("fs");
  const filePath = exportFolder + "/users.json";

  // jsonファイルの書き出し
  try
  {
    fs.writeFileSync(filePath, users);
  }
  catch(e)
  {
    console.log(e);
  }

  return new Promise((resolve, reject) => {
    resolve("success");
    });
}

// 3. 履歴jsonの書き出し
async function writeChannelHistoryJson(channelId, channelName)
{
  // 会話情報を取得
  var history = await getHistory(channelId);
  var threadMessages = [];
  
  // 会話情報を一つづつ解析し、スレッド情報を取得
  await (async () => {
    for await (message of history) 
    {
      // ファイルトークンの付与
      message = addFileToken(message);

      const ts = message.ts;
      const replies = await getReplies(channelId, ts)
      
      var items = [];
      var count = 0;
      
      // スレッドを1つづつ解析し、スレッド情報とメッセージ情報を保持
      replies.forEach(thread => 
      {
        // 最初のメッセージは自身のものなので除外
        count += 1;
        if(count == 1)
          return;

        // ファイルトークンの付与
        thread = addFileToken(thread);
        
        // スレッド情報を保持
        const user = thread.user;
        const ts = thread.ts;
        
        items.push({
        "user": user,
        "ts": ts
        })
        
        // スレッドメーセージを保持
        threadMessages.push(thread);
      });
      
      if(items.length > 0)
      {
        message.replies = items;
      }
    }
  })();
  
  // 保持したスレッドメッセージを末尾に追加
  var result = history.concat(threadMessages);
  
  // json形式で書き出し
  result = JSON.stringify(result);
  console.log(result);
  await writeExportFile(channelName, result);

  return new Promise((resolve, reject) => {
    resolve("success");
    });
}

// 3.1. 履歴の取得
async function getHistory(channel)
{
  const history = await app.client.conversations.history({
  channel: channel,
  include_all_metadata: true,
  });

  return new Promise((resolve, reject) => {
  resolve(history.messages);
  });
}

// 3.2. スレッドの取得
async function getReplies(channel, ts)
{
  const replies = await app.client.conversations.replies({
  channel: channel,
  ts: ts,
  });

  return new Promise((resolve, reject) => {
  resolve(replies.messages);
  });
}

// 3.3. ファイルメッセージのトークン付与
function addFileToken(message)
{
  const token = process.env.SLACK_FILE_TOKEN;

  // ファイルが存在するメッセージを解析してトークンを付与
  if(message.files && message.files.length > 0)
  {
    console.log("ファイルが付与されたメッセージ");
    message.files.forEach(file => 
    {
       // 直指定でトークンを付与 
        file.url_private += `?t=${token}`;
        file.url_private_download += `?t=${token}`;
        file.thumb_64 += `?t=${token}`;
        file.thumb_80 += `?t=${token}`;
        file.thumb_360 += `?t=${token}`;
        file.thumb_480 += `?t=${token}`;
        file.thumb_160 += `?t=${token}`;
    });
  }

  return message;
}

// 3.4. ファイルに保存
async function writeExportFile(channelName, history)
{
  var fs = require("fs");

  const channelFolder = exportFolder + "/" + channelName;
  const filePath = channelFolder + "/2022-12-23.json";

  // 対象チャンネルのフォルダが無ければ作成
  if(!fs.existsSync(channelFolder))
  {
    fs.mkdirSync(channelFolder);
  }

  // jsonファイルの書き出し
  try
  {
    fs.writeFileSync(filePath, history);
    console.log("end");
  }catch(e)
  {
    console.log(e);
  }

  return new Promise((resolve, reject) => {
    resolve("success");
    });
}

// 4. zip化
async function forZip(targetPath, exportPath)
{
  execSync(`zip -r ${exportPath} ${targetPath}`)

  return new Promise((resolve, reject) => {
    resolve("success");
    });
}

(async () => {
  // アプリを起動します
  await app.start();
  console.log('⚡️ Bolt app is running!');
})();