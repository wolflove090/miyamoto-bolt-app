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

// ユーザートークンを利用するアプリ
const userApp = new App({
  token: process.env.SLACK_BOT_USER_TOKEN,
  signingSecret: process.env.SLACK_SIGNING_SECRET,
  socketMode: true,
  appToken: process.env.SLACK_APP_TOKEN,
  // ソケットモードではポートをリッスンしませんが、アプリを OAuth フローに対応させる場合、
  // 何らかのポートをリッスンする必要があります
  port: process.env.PORT || 3000
});

// メッセージに反応してアクションを発火
app.message('export', async ({ message, say }) => {

  // 対象のチャンネルIDを指定します
  const targetChannels = getTargetChannels(); // 直指定
  //const targetChannels = getTargetChannelsForCsv(); // CSV指定

  console.log("出力");

  // エクスポート対象のフォルダが無ければ作成
  var fs = require("fs");
  if(!fs.existsSync(exportFolder))
  {
    fs.mkdirSync(exportFolder);
  }

  // ユーザー情報の保存
  const users = await writeUsersJson();
  // 制限ユーザーの取得
  const restrictedUsers = getRestrictedUsers(users);

  // チャンネル情報の保存
  var channels = await writeChannelsJson(targetChannels);

  // 書き出せないチャンネルがあれば抜ける
  if(isChannelAllExport(targetChannels, channels))
  {
    console.log("チャンネル書き出を停止しました。");
    return;
  }

  // 対象のチャンネルのみ書き出し
  await (async () => {
    for await (channel of channels) 
    {
        // チャンネルメッセージの書き出し
        await writeChannelHistoryJson(channel.id, channel.name, restrictedUsers);
    }
  })();

  // 書き出し対象をzip化
  await forZip("./slack_export_test", "slack_export_test.zip");

  console.log("Export Completed!!");

  console.log("Start Archive");

  // 対象のチャンネルのリネーム & アーカイブ
  await (async () => {
    for await (channel of channels) 
    {
        // チャンネルのリネーム
        await renameChannel(channel.id, channel.name);
        // チャンネルのアーカイブ
        await archiveChannel(channel.id);
    }
  })();

  console.log("Archive Completed!!");
});

// 0. 対象のチャンネル一覧を取得する
function getTargetChannels()
{
  return ["C04FSRFRE7N"];
}

// 0. 対象のチャンネル一覧を取得する
function getTargetChannelsForCsv()
{
  // ローカルファイル読み取り
  var fs = require("fs");
  var csv = fs.readFileSync("targetChannels.csv", 'utf-8');
  csv = csv.replace(/\r?\n/g, '');
  const targets = csv.split(",");
  var targetChannels = [];

  // チャンネルのみ追加(頭文字が「C」のもの)
  targets.forEach(target => 
    {
      const head = target.slice(0, 1);
      if(head == "C")
      {
        targetChannels.push(target);
      }
    });

  return targetChannels;
}

// 1.チャンネル情報の書き出し
async function writeChannelsJson(targetChannels)
{
  var channels = [];

  var cursor = "";
  while (true)
  {
      // チャンネル一覧の取得
      const response = await app.client.conversations.list({
       types: "public_channel,private_channel",
       cursor: cursor,
      });

      channels = channels.concat(response.channels);

      // 次のチャンネルが無ければ抜ける
      if(response.response_metadata && response.response_metadata.next_cursor == "")
      {
        break;
      }
      console.log(`次のチャンネルがある${cursor}`);
      cursor = response.response_metadata.next_cursor;
  }

  var result = [];

  channels.forEach(ch => 
    {
      // 対象チャンネルのみ収集
      if(targetChannels.includes(ch.id))
      {
        console.log(`対象チャンネル：${ch.name}`);
        ch.is_private = false;
        result.push(ch);
      }
    })

  // 各チャンネルのメンバー情報を個別で取得
  await (async () => {
    for await (channel of result) 
    {
      const channelId = channel.id;
      const members = await getChannelMembers(channelId);
      channel.members = members;
    }
  })();

  // jsonString変換
  const resultJson = JSON.stringify(result, null, '\t');

  var fs = require("fs");
  const filePath = exportFolder + "/channels.json";

  // jsonファイルの書き出し
  try
  {
    fs.writeFileSync(filePath, resultJson);
  }
  catch(e)
  {
    console.log(e);
  }

  return new Promise((resolve, reject) => {
    resolve(result);
    });
}

// 1.1 チャンネル参加メンバーを取得
async function getChannelMembers(channelId)
{
  var members = [];
  var cursor = "";
  while (true)
  {
      // メンバー一覧の取得
      const response = await app.client.conversations.members({
        channel: channelId,
        cursor: cursor,
      });
      members = members.concat(response.members);

      // 次のメンバーが無ければ抜ける
      if(response.response_metadata && response.response_metadata.next_cursor == "")
      {
        break;
      }
      console.log(`次のメンバーがある${cursor}`);
      cursor = response.response_metadata.next_cursor;
  }

  // 投稿用ユーザーの追加
  members.push(process.env.SLACK_FILE_POST_MEMBER);

  return new Promise((resolve, reject) => {
    resolve(members);
    });
}

// 1.2 チャンネルが全て書き出せているかを確認
function isChannelAllExport(targets, channels)
{
  var channelIds = [];
  channels.forEach(channel => channelIds.push(channel.id));

  var isNotTargetFind = false;
  targets.forEach(target => 
    {
      if(!channelIds.includes(target))
      {
        console.log(`対象のチャンネルが書き出せませんでした。`);
        console.log(`対象チャンネルにアプリが追加されているか確認してください。対象チャンネル：${target}`);
        isNotTargetFind = true;
      }
    })

    return isNotTargetFind;
}

// 2. ユーザー一覧の書き出し
async function writeUsersJson()
{
  var users = [];

  var cursor = "";
  while (true)
  {
    const response = await app.client.users.list({
      cursor: cursor,
    });

    users = users.concat(response.members);

    // 次のユーザーが無ければ抜ける
    if(response.response_metadata && response.response_metadata.next_cursor == "")
    {
      break;
    }

    console.log(`次のユーザーがある${cursor}`);
    cursor = response.response_metadata.next_cursor;

  }
  const result = JSON.stringify(users, null, '\t');

  var fs = require("fs");
  const filePath = exportFolder + "/users.json";

  // jsonファイルの書き出し
  try
  {
    fs.writeFileSync(filePath, result);
  }
  catch(e)
  {
    console.log(e);
  }

  return new Promise((resolve, reject) => {
    resolve(users);
    });
}

// 2.1 ゲストユーザー一覧取得
function getRestrictedUsers(users)
{
  const restrictedUsers = [];

  users.forEach(user => 
    {
      // 制限ユーザー = ゲストユーザーなので追加
      if(user.is_restricted == true)
      {
        restrictedUsers.push(user.id);
      }
    })

    return restrictedUsers;
}

// 3. 履歴jsonの書き出し
async function writeChannelHistoryJson(channelId, channelName, restrictedUsers)
{
  // 会話情報を取得
  var history = await getHistory(channelId);
  var threadMessages = [];
  
  // 会話情報を一つづつ解析し、スレッド情報を取得
  await (async () => {
    for await (message of history) 
    {
      // ファイルトークンの付与
      message = addFileToken(message, restrictedUsers);

      const ts = message.ts;
      const replies = await getReplies(channelId, ts)
      
      var items = [];
      
      // スレッドを1つづつ解析し、スレッド情報とメッセージ情報を保持
      replies.forEach(thread => 
      {
        // ファイルトークンの付与
        thread = addFileToken(thread, restrictedUsers);
        
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
  result = JSON.stringify(result, null, '\t');
  console.log(result);
  await writeExportFile(channelName, result);

  return new Promise((resolve, reject) => {
    resolve("success");
    });
}

// 3.1. 履歴の取得
async function getHistory(channel)
{
  var history = [];

  var cursor = "";
  while (true)
  {
    const response = await app.client.conversations.history({
      channel: channel,
      include_all_metadata: true,
      cursor: cursor,
      //limit: 5, カーソルテスト用
      });

      history = history.concat(response.messages);

      // 次のメッセージが無ければ抜ける
      if(response.has_more == false)
      {
        break;
      }

      console.log(`次のメッセージがある${cursor}`);

      cursor = response.response_metadata.next_cursor;
  }

  return new Promise((resolve, reject) => {
  resolve(history);
  });
}

// 3.2. スレッドの取得
async function getReplies(channel, ts)
{
  var history = [];

  var cursor = "";
  while (true)
  {
    const response = await app.client.conversations.replies({
      channel: channel,
      ts: ts,
      cursor: cursor,
      // limit: 1, カーソルテスト用
      });

      // スレッド主もレスポンスに入ってくるためそれ以外を挿入
      response.messages.forEach(repli => 
        {
          if(repli.ts != ts)
          {
            history.push(repli);
          }
        });

      // 次のメッセージが無ければ抜ける
      if(response.has_more == false)
      {
        break;
      }

      console.log(`次のメッセージがある${cursor}`);

      cursor = response.response_metadata.next_cursor;
  }

  return new Promise((resolve, reject) => {
  resolve(history);
  });
}

// 3.3. ファイルメッセージのトークン付与
function addFileToken(message, restrictedUsers)
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

        // ゲストユーザーだった場合に投稿ユーザーを変更
        if(restrictedUsers.includes(file.user))
        {
          file.user = process.env.SLACK_FILE_POST_MEMBER;
        }
    });

    // ゲストユーザーだった場合に投稿ユーザーを変更
    if(restrictedUsers.includes(message.user))
    {
      console.log("ゲストユーザー");
      message.user = process.env.SLACK_FILE_POST_MEMBER;
    }
  }

  return message;
}

// 3.4. ファイルに保存
async function writeExportFile(channelName, history)
{
  var fs = require("fs");

  const channelFolder = exportFolder + "/" + channelName;
  const filePath = channelFolder + "/history.json";

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

// 5. チャンネルのリネーム
async function renameChannel(channelId, channelName)
{
  // ユーザー権限でリネーム(管理者権限が必要)
  await userApp.client.conversations.rename({
    channel: channelId,
    name: channelName + "_archive"
  })

  return new Promise((resolve, reject) => {
    resolve("success");
    });
}

// 6. チャンネルのアーカイブ
async function archiveChannel(channelId)
{
  // チャンネルのアーカイブ
  await app.client.conversations.archive({
    channel: channelId,
  })

  return new Promise((resolve, reject) => {
    resolve("success");
    });
}

(async () => {
  // アプリを起動します
  await app.start();
  console.log('⚡️ Bolt app is running!');
})();