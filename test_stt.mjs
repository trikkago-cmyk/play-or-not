import fs from 'fs';

// Create a small dummy webm file
const dummyWebm = Buffer.from('1a45dfa39f4286810142f7810142f2810442f381084282847765626d87428284765f3831', 'hex');
fs.writeFileSync('test_audio.webm', dummyWebm);

async function test() {
    const formData = new FormData();
    const fileBlob = new Blob([dummyWebm], { type: 'audio/webm' });
    formData.append('file', fileBlob, 'test_audio.webm');

    try {
        const res = await fetch('https://play-or-not-dm.vercel.app/api/stt', {
            method: 'POST',
            body: formData
        });

        console.log('Status:', res.status);
        const text = await res.text();
        console.log('Response:', text);
    } catch (e) {
        console.error('Fetch error:', e);
    }
}

test();
