const { App } = require('@slack/bolt');
require('dotenv').config();

const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  signingSecret: process.env.SLACK_SIGNING_SECRET,
  socketMode: true,
  appToken: process.env.SLACK_APP_TOKEN,
  // ソケットモードではポートをリッスンしませんが、アプリを OAuth フローに対応させる場合、
  // 何らかのポートをリッスンする必要があります
  port: process.env.PORT || 3000
});

app.message('hoge', async ({ message, say }) => {
  const channel = "C04FSRFRE7N";

  // 会話情報を取得
  var history = await getHistory(channel);
  var threadMessages = [];
  
  console.log("メッセージ出力なんだなぁ");
  
  // 会話情報を一つづつ解析し、スレッド情報を取得
  await (async () => {
    for await (message of history) {
      const ts = message.ts;
      const replies = await getReplies(channel, ts)
      
      var items = [];
      
      var count = 0;
      
      // スレッドを1つづつ解析し、スレッド情報とメッセージ情報を保持
      replies.forEach(thread => 
      {
        // 最初のメッセージは自身のものなので除外
        count += 1;
        if(count == 1)
          return;
        
        //console.log(thread)
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
  
  //console.log(result);
  console.log(JSON.stringify(result));
});

// 1. 履歴の取得
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

// 2. スレッドの取得
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

(async () => {
  // アプリを起動します
  await app.start();

  console.log('⚡️ Bolt app is running!');
})();