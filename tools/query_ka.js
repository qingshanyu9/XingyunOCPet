const crypto = require('crypto');
const axios = require('axios');
const readline = require('readline');

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

console.log("=== KA 动作查询工具 ===");

rl.question('请输入 AppID: ', (ak) => {
    rl.question('请输入 AppSecret: ', (sk) => {
        // 关闭 readline 避免挂起，但不立即结束进程，等待异步请求完成
        rl.close();
        if (!ak || !sk) {
            console.error("AppID 或 Secret 不能为空！");
            return;
        }
        queryKA(ak.trim(), sk.trim());
    });
});

async function queryKA(ak, secret) {
    const host = 'https://nebula-agent.xingyun3d.com';
    const api_path = '/user/v1/external/lite_ka_summary';
    const method = 'GET';

    // 1. 计算时间戳 (秒级)
    const timestamp = Math.floor(Date.now() / 1000).toString();

    // 2. 构造签名字符串
    const lower_path = api_path.toLowerCase();
    const lower_method = method.toLowerCase();
    
    // data为空字典时，json字符串为 "{}"
    const sort_json_str = "{}"; 

    // 拼接原始签名串
    const raw_sign = lower_path + lower_method + sort_json_str + secret + timestamp;
    const sign = crypto.createHash('md5').update(raw_sign, 'utf8').digest('hex');

    // 输出调试日志
    console.log('---------------------------');
    console.log('准备发送请求...');
    console.log(`请求URL: ${host + api_path}`);
    console.log(`时间戳: ${timestamp}`);
    console.log(`签名: ${sign}`);

    try {
        // 3. 发起请求
        const response = await axios.get(host + api_path, {
            headers: {
                'X-APP-ID': ak,
                'X-TIMESTAMP': timestamp,
                'X-TOKEN': sign,
                'Content-Type': 'application/json'
            }
        });

        console.log('\n=== ✅ 查询成功! ===');
        const list = response.data.data;

        // 输出查询结果
        if (list && list.length > 0) {
            console.log(`共找到 ${list.length} 个动作：\n`);
            console.log(`| 动作名称 (填入代码) | 中文说明 |`);
            console.log(`|---|---|`);
            list.forEach(item => {
                console.log(`| ${item.name.padEnd(30)} | ${item.cn_name} |`);
            });
            console.log('\n👉 请将左侧的 "动作名称" 复制到 config.js 的 actions 列表中。');
        } else {
            console.log('⚠️ 查询成功，但该应用下没有配置任何动作数据。');
            console.log('原始返回:', JSON.stringify(response.data, null, 2));
        }
    } catch (error) {
        console.error('\n❌ 查询失败:');
        if (error.response) {
            console.error(`状态码: ${error.response.status}`);
            console.error('错误信息:', JSON.stringify(error.response.data, null, 2));
            if (error.response.data.error_code) {
                 console.error('请检查 AppID 和 Secret 是否正确，或时间戳是否同步。');
            }
        } else {
            console.error(error.message);
        }
    }
}
