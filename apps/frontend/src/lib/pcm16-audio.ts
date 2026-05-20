const TARGET_SAMPLE_RATE = 24_000;

export function float32ToPcm16Base64(samples: Float32Array): string {
	const bytes = new Uint8Array(samples.length * 2);
	const view = new DataView(bytes.buffer);
	for (let i = 0; i < samples.length; i++) {
		const clamped = Math.max(-1, Math.min(1, samples[i]));
		view.setInt16(i * 2, clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff, true);
	}
	let binary = '';
	for (let i = 0; i < bytes.length; i++) {
		binary += String.fromCharCode(bytes[i]);
	}
	return btoa(binary);
}

export function downsampleToPcm16Base64(input: Float32Array, inputSampleRate: number): string {
	if (inputSampleRate === TARGET_SAMPLE_RATE) {
		return float32ToPcm16Base64(input);
	}

	const ratio = inputSampleRate / TARGET_SAMPLE_RATE;
	const outputLength = Math.floor(input.length / ratio);
	const output = new Float32Array(outputLength);
	for (let i = 0; i < outputLength; i++) {
		const start = Math.floor(i * ratio);
		const end = Math.floor((i + 1) * ratio);
		let sum = 0;
		let count = 0;
		for (let j = start; j < end && j < input.length; j++) {
			sum += input[j];
			count++;
		}
		output[i] = count > 0 ? sum / count : 0;
	}
	return float32ToPcm16Base64(output);
}

export function createMicPcm16Stream(onChunk: (base64Pcm16: string) => void): {
	analyser: AnalyserNode;
	stop: () => void;
} {
	const audioContext = new AudioContext();
	const analyser = audioContext.createAnalyser();
	analyser.fftSize = 512;
	analyser.smoothingTimeConstant = 0.4;

	let mediaStream: MediaStream | null = null;
	let processor: ScriptProcessorNode | null = null;
	let source: MediaStreamAudioSourceNode | null = null;
	let stopped = false;

	const start = async () => {
		mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
		source = audioContext.createMediaStreamSource(mediaStream);
		source.connect(analyser);
		processor = audioContext.createScriptProcessor(4096, 1, 1);
		processor.onaudioprocess = (event) => {
			if (stopped) {
				return;
			}
			const channel = event.inputBuffer.getChannelData(0);
			onChunk(downsampleToPcm16Base64(channel, audioContext.sampleRate));
		};
		source.connect(processor);
		processor.connect(audioContext.destination);
	};

	void start();

	return {
		analyser,
		stop: () => {
			stopped = true;
			processor?.disconnect();
			source?.disconnect();
			mediaStream?.getTracks().forEach((track) => track.stop());
			void audioContext.close();
		},
	};
}
