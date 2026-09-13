package com.flipflip.transcoder;

import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.ImageDecoder;
import android.os.Build;
import android.media.MediaCodec;
import android.media.MediaCodecInfo;
import android.media.MediaCodecList;
import android.media.MediaExtractor;
import android.media.MediaFormat;
import android.media.MediaMetadataRetriever;
import android.media.MediaMuxer;
import android.util.Log;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;
import java.io.FileOutputStream;
import java.nio.ByteBuffer;

/**
 * FlipTranscoder — native media optimizer for FlipFlip.
 *
 * Converts heavy camera images/videos (HDR, >1080p, oversized or high bitrate)
 * to basic SDR 1080p copies at import time. Paths are relative to
 * Directory.Data (app files dir).
 */
@CapacitorPlugin(name = "FlipTranscoder")
public class FlipTranscoderPlugin extends Plugin {

    private static final int DEFAULT_MAX_DIMENSION = 1920;
    private static final long MAX_BYTES = 8L * 1024 * 1024;
    // Videos above this size or overall bitrate get re-encoded even when they
    // are already <=1080p AND SDR — decoding them stays cheap in the WebView.
    private static final long VIDEO_MAX_BYTES = 100L * 1024 * 1024;
    private static final long VIDEO_MAX_BITRATE = 20_000_000L;
    private static final String[] IMAGE_EXTS = {"jpg", "jpeg", "png", "gif", "webp", "tiff", "bmp", "heic", "heif"};
    private static final String[] VIDEO_EXTS = {"mp4", "mov", "m4v", "webm"};

    private static volatile boolean cancelled = false;

    /**
     * Abort any in-flight conversion. The original file is kept intact and the
     * partial optimized output is removed so the raw import survives a
     * "Save as-is" (Skip) request.
     */
    @PluginMethod
    public void cancel(PluginCall call) {
        cancelled = true;
        call.resolve();
    }

    private File root() {
        return getContext().getFilesDir();
    }

    private File abs(String rel) {
        return new File(root(), rel);
    }

    private boolean inArray(String[] arr, String v) {
        for (String s : arr) if (s.equals(v)) return true;
        return false;
    }

    private String extOf(String name) {
        int i = name.lastIndexOf('.');
        return i < 0 ? "" : name.substring(i + 1).toLowerCase();
    }

    private String dirOf(String name) {
        int i = name.lastIndexOf('/');
        if (i < 0) return "";
        String dir = name.substring(0, i);
        return dir.endsWith("/") ? dir : dir + "/";
    }

    private String stem(String name) {
        int i = name.lastIndexOf('.');
        if (i < 0) return name;
        String s = name.substring(0, i);
        int j = s.lastIndexOf('/');
        return j < 0 ? s : s.substring(j + 1);
    }

    @PluginMethod
    public void probe(PluginCall call) {
        String rel = call.getString("path");
        if (rel == null || rel.isEmpty()) {
            call.reject("path is required");
            return;
        }
        File f = abs(rel);
        String ext = extOf(rel);
        try {
            if (inArray(IMAGE_EXTS, ext)) {
                int[] dims = imageDims(f);
                long size = f.length();
                boolean convert = size > MAX_BYTES || ext.equals("heic") || ext.equals("heif") || dims[0] > DEFAULT_MAX_DIMENSION || dims[1] > DEFAULT_MAX_DIMENSION;
                call.resolve(new JSObject().put("kind", "image").put("width", dims[0]).put("height", dims[1]).put("convert", convert));
                return;
            }
            if (inArray(VIDEO_EXTS, ext)) {
                int[] vdims = new int[]{0, 0};
                long videobitrate = 0;
                try (MediaMetadataRetriever r = new MediaMetadataRetriever()) {
                    r.setDataSource(f.getAbsolutePath());
                    String w = r.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_WIDTH);
                    String h = r.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_HEIGHT);
                    if (w != null) vdims[0] = Integer.parseInt(w);
                    if (h != null) vdims[1] = Integer.parseInt(h);
                    String br = r.extractMetadata(MediaMetadataRetriever.METADATA_KEY_BITRATE);
                    if (br != null) {
                        try { videobitrate = Long.parseLong(br); } catch (Exception ignored) {}
                    }
                } catch (Exception ignored) {}
                boolean hdr = isHdrVideo(f);
                boolean heavy = f.length() > VIDEO_MAX_BYTES || videobitrate > VIDEO_MAX_BITRATE;
                boolean convert = hdr || Math.max(vdims[0], vdims[1]) > DEFAULT_MAX_DIMENSION || heavy;
                call.resolve(new JSObject().put("kind", "video").put("width", vdims[0]).put("height", vdims[1]).put("convert", convert));
                return;
            }
        } catch (Exception e) {
            call.resolve(new JSObject().put("kind", "other").put("width", 0).put("height", 0).put("convert", false));
            return;
        }
        call.resolve(new JSObject().put("kind", "other").put("width", 0).put("height", 0).put("convert", false));
    }

    @PluginMethod
    public void convert(PluginCall call) {
        String rel = call.getString("path");
        if (rel == null || rel.isEmpty()) {
            call.reject("path is required");
            return;
        }
int maxDim = call.getInt("maxDimension", DEFAULT_MAX_DIMENSION);
        boolean keepOriginal = Boolean.TRUE.equals(call.getBoolean("keepOriginal", false));
        File f = abs(rel);
        String ext = extOf(rel);
        String outRel = rel;
        boolean converted = false;
        cancelled = false;
        try {
            if (inArray(IMAGE_EXTS, ext)) {
                String[] r = convertImage(f, rel, maxDim, keepOriginal);
                outRel = r[0];
                converted = Boolean.parseBoolean(r[1]);
            } else if (inArray(VIDEO_EXTS, ext)) {
                String[] r = convertVideo(f, rel, maxDim, keepOriginal);
                outRel = r[0];
                converted = Boolean.parseBoolean(r[1]);
            }
        } catch (Exception e) {
            Log.e("FlipTranscoder", "convert failed", e);
        }
        JSObject res = new JSObject().put("outputPath", outRel).put("converted", converted);
        call.resolve(res);
    }

    private int[] imageDims(File f) {
        BitmapFactory.Options o = new BitmapFactory.Options();
        o.inJustDecodeBounds = true;
        BitmapFactory.decodeFile(f.getAbsolutePath(), o);
        return new int[]{o.outWidth, o.outHeight};
    }

    private String[] convertImage(File f, String rel, int maxDim, boolean keepOriginal) {
        int[] dims = imageDims(f);
        if (!(dims[0] > maxDim || dims[1] > maxDim || f.length() > MAX_BYTES || extOf(rel).equals("heic") || extOf(rel).equals("heif"))) {
            return new String[]{rel, "false"};
        }
        Bitmap bmp = null;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            try {
                bmp = ImageDecoder.decodeBitmap(ImageDecoder.createSource(f), (decoder, info, s) -> {
                    decoder.setTargetSize(maxDim, maxDim);
                    decoder.setAllocator(ImageDecoder.ALLOCATOR_SOFTWARE);
                });
            } catch (Exception e) {
                Log.w("FlipTranscoder", "ImageDecoder failed, falling back", e);
            }
        }
        if (bmp == null) {
            BitmapFactory.Options o = new BitmapFactory.Options();
            int sample = 1;
            while (dims[0] / sample > maxDim || dims[1] / sample > maxDim) sample <<= 1;
            o.inSampleSize = sample;
            bmp = BitmapFactory.decodeFile(f.getAbsolutePath(), o);
        }
        if (bmp == null) return new String[]{rel, "false"};

        String outRel = dirOf(rel) + stem(rel) + "__sdr1080.jpg";
        File out = abs(outRel);
        try (FileOutputStream fos = new FileOutputStream(out)) {
            bmp.compress(Bitmap.CompressFormat.JPEG, 85, fos);
        } catch (Exception e) {
            Log.e("FlipTranscoder", "image save failed", e);
            return new String[]{rel, "false"};
        } finally {
            if (bmp != null && !bmp.isRecycled()) bmp.recycle();
        }
        if (cancelled) {
            out.delete();
            return new String[]{rel, "false"};
        }
        if (!keepOriginal) {
            f.delete();
        }
        return new String[]{outRel, "true"};
    }

    private boolean isHdrVideo(File f) {
        MediaExtractor ex = new MediaExtractor();
        try {
            ex.setDataSource(f.getAbsolutePath());
            for (int i = 0; i < ex.getTrackCount(); i++) {
                MediaFormat fmt = ex.getTrackFormat(i);
                String mime = fmt.getString(MediaFormat.KEY_MIME);
                if (mime == null || !mime.startsWith("video/")) continue;
                if (fmt.containsKey(MediaFormat.KEY_COLOR_TRANSFER)) {
                    int transfer = fmt.getInteger(MediaFormat.KEY_COLOR_TRANSFER);
                    if (transfer == MediaFormat.COLOR_TRANSFER_ST2084 || transfer >= MediaFormat.COLOR_TRANSFER_HLG) return true;
                }
                if (fmt.containsKey(MediaFormat.KEY_COLOR_STANDARD)) {
                    int cs = fmt.getInteger(MediaFormat.KEY_COLOR_STANDARD);
                    if (cs == MediaFormat.COLOR_STANDARD_BT2020) return true;
                }
            }
        } catch (Exception ignored) {
        } finally {
            try { ex.release(); } catch (Exception ignored) {}
        }
        return false;
    }

    /**
     * Same triggers as probe()'s video branch: HDR, oversized (>100 MB), high
     * bitrate (>20 Mbps), or wider/taller than maxDim.
     */
    private boolean videoNeedsConvert(File f, int maxDim) {
        if (f.length() > VIDEO_MAX_BYTES) return true;
        MediaMetadataRetriever r = new MediaMetadataRetriever();
        try {
            r.setDataSource(f.getAbsolutePath());
            String w = r.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_WIDTH);
            String h = r.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_HEIGHT);
            if (w != null || h != null) {
                int width = w != null ? Integer.parseInt(w) : 0;
                int height = h != null ? Integer.parseInt(h) : 0;
                if (Math.max(width, height) > maxDim) return true;
            }
            String br = r.extractMetadata(MediaMetadataRetriever.METADATA_KEY_BITRATE);
            if (br != null) {
                try { if (Long.parseLong(br) > VIDEO_MAX_BITRATE) return true; } catch (Exception ignored) {}
            }
        } catch (Exception ignored) {
        } finally {
            try { r.release(); } catch (Exception ignored) {}
        }
        return isHdrVideo(f);
    }

    private String[] convertVideo(File f, String rel, int maxDim, boolean keepOriginal) {
        // Mirror the probe triggers so a convert call for an already-fine file
        // is a no-op (and never deletes anything).
        if (!videoNeedsConvert(f, maxDim)) {
            return new String[]{rel, "false"};
        }
        String outRel = dirOf(rel) + stem(rel) + "__sdr1080.mp4";
        File out = abs(outRel);
        boolean ok = transcodeVideo(f.getAbsolutePath(), out.getAbsolutePath(), maxDim);
        // Save-as-is (Skip): never delete the import, drop the partial output.
        if (!ok || cancelled) {
            if (out.exists()) out.delete();
            return new String[]{rel, "false"};
        }
        if (out.exists() && out.length() > 0) {
            if (!keepOriginal) {
                f.delete();
            }
            return new String[]{outRel, "true"};
        }
        return new String[]{rel, "false"};
    }

    /**
     * Transcode/wrap a video to H.264 MP4 with the longest side <= 1080px/1920px.
     * Falls back to passthrough remux when the input is already H.264 and the
     * resolution fits, otherwise does a full decode -> encode loop.
     */
    private boolean transcodeVideo(String in, String out, int maxDim) {
        // Passthrough remux for already-conformant H.264 media.
        try {
            if (tryRemuxPassThrough(in, out, maxDim)) return true;
        } catch (Exception e) {
            Log.w("FlipTranscoder", "remux passthrough failed, transcoding", e);
        }
        try {
            transcodeLoop(in, out, maxDim);
            return out != null && new File(out).exists() && new File(out).length() > 0;
        } catch (Exception e) {
            Log.e("FlipTranscoder", "transcode failed", e);
        }
        return false;
    }

    /**
     * If the input is H.264 (or not HEVC), audio only, or small enough, remux to
     * MP4 via MediaMuxer passthrough so we never recompress fine clips.
     */
    private boolean tryRemuxPassThrough(String in, String out, int maxDim) throws Exception {
        MediaExtractor ex = new MediaExtractor();
        try {
            ex.setDataSource(in);
            boolean hevc = false;
            boolean hdr = false;
            boolean hasVideo = false;
            int maxW = 0, maxH = 0;
            double maxBit = 0;
            for (int i = 0; i < ex.getTrackCount(); i++) {
                MediaFormat fmt = ex.getTrackFormat(i);
                String mime = fmt.getString(MediaFormat.KEY_MIME);
                if (mime == null) continue;
                if (mime.startsWith("video/")) {
                    hasVideo = true;
                    if (mime.toLowerCase().contains("hevc") || mime.equals(MediaFormat.MIMETYPE_VIDEO_HEVC)) hevc = true;
                    if (!mime.equals(MediaFormat.MIMETYPE_VIDEO_AVC)) return false; // not h264 -> transcode
                    if (fmt.containsKey(MediaFormat.KEY_COLOR_TRANSFER)) {
                        int transfer = fmt.getInteger(MediaFormat.KEY_COLOR_TRANSFER);
                        if (transfer == MediaFormat.COLOR_TRANSFER_ST2084 || transfer >= MediaFormat.COLOR_TRANSFER_HLG) hdr = true;
                    }
                    if (fmt.containsKey(MediaFormat.KEY_COLOR_STANDARD)) {
                        if (fmt.getInteger(MediaFormat.KEY_COLOR_STANDARD) == MediaFormat.COLOR_STANDARD_BT2020) hdr = true;
                    }
                    maxW = Math.max(maxW, fmt.getInteger(MediaFormat.KEY_WIDTH));
                    maxH = Math.max(maxH, fmt.getInteger(MediaFormat.KEY_HEIGHT));
                    Integer br = null;
                    try { br = fmt.getInteger(MediaFormat.KEY_BIT_RATE); } catch (Exception ignored) {}
                    if (br != null) maxBit = Math.max(maxBit, br);
                }
            }
            if (!hasVideo) return false;
            // HDR must be tone-mapped to SDR and oversized files recompressed to
            // shrink — a passthrough copy would keep both intact.
            if (hdr || new File(in).length() > VIDEO_MAX_BYTES) return false;
            if (hevc || Math.max(maxW, maxH) > maxDim) return false;
            if (maxBit > 15_000_000) return false; // very high bitrate -> transcode
        } finally {
            try { ex.release(); } catch (Exception ignored) {}
        }
        return remuxMp4(in, out);
    }

    /** Straight-forward copy remux (no re-encode) to an MP4 container. */
    private boolean remuxMp4(String in, String out) {
        MediaExtractor ex = new MediaExtractor();
        MediaMuxer muxer = null;
        try {
            muxer = new MediaMuxer(out, MediaMuxer.OutputFormat.MUXER_OUTPUT_MPEG_4);
            ex.setDataSource(in);
            int[] trackIndex = new int[ex.getTrackCount()];
            int muxerTrackCount = 0;
            for (int i = 0; i < ex.getTrackCount(); i++) {
                MediaFormat fmt = ex.getTrackFormat(i);
                String mime = fmt.getString(MediaFormat.KEY_MIME);
                if (mime == null || !(mime.startsWith("video/") || mime.startsWith("audio/"))) {
                    trackIndex[i] = -1;
                    continue;
                }
                // Convert HEVC/AVC to H.264-compatible mime is not possible via remux, so skip non-avc here.
                if (mime.startsWith("video/") && !mime.equals(MediaFormat.MIMETYPE_VIDEO_AVC)) {
                    trackIndex[i] = -1;
                    continue;
                }
                trackIndex[i] = muxer.addTrack(fmt);
                muxerTrackCount++;
            }
            if (muxerTrackCount == 0) return false;
            muxer.start();
            long offsetUs = 0;
            for (int ti = 0; ti < ex.getTrackCount(); ti++) {
                int idx = trackIndex[ti];
                if (idx < 0) continue;
                MediaFormat fmt = ex.getTrackFormat(ti);
                int bufSize = fmt.containsKey(MediaFormat.KEY_MAX_INPUT_SIZE) ? fmt.getInteger(MediaFormat.KEY_MAX_INPUT_SIZE) : 1024 * 1024;
                ByteBuffer buf = ByteBuffer.allocate(bufSize);
                MediaCodec.BufferInfo info = new MediaCodec.BufferInfo();
                ex.selectTrack(ti);
                boolean eos = false;
                long startUs = -1;
                while (!eos) {
                    if (cancelled) break;
                    int n = ex.readSampleData(buf, 0);
                    if (n < 0) {
                        eos = true;
                        break;
                    }
                    info.offset = 0;
                    info.size = n;
                    info.presentationTimeUs = ex.getSampleTime();
                    if (startUs < 0) startUs = info.presentationTimeUs;
                    info.presentationTimeUs -= startUs;
                    info.flags = ex.getSampleFlags();
                    long lastPts = info.presentationTimeUs + offsetUs;
                    if (lastPts < 0) lastPts = 0;
                    if (info.presentationTimeUs < 0) info.presentationTimeUs = 0;
                    muxer.writeSampleData(idx, buf, info);
                    ex.advance();
                    offsetUs = Math.min(offsetUs, 0);
                }
            }
            muxer.stop();
            return new File(out).exists();
        } catch (Exception e) {
            Log.e("FlipTranscoder", "remux failed", e);
            new File(out).delete();
            return false;
        } finally {
            if (muxer != null) {
                try { muxer.release(); } catch (Exception ignored) {}
            }
            try { ex.release(); } catch (Exception ignored) {}
        }
    }

    private boolean hasEncoder(String mime) {
        MediaCodecList list = new MediaCodecList(MediaCodecList.REGULAR_CODECS);
        for (MediaCodecInfo ci : list.getCodecInfos()) {
            if (!ci.isEncoder() || !ci.isHardwareAccelerated()) continue;
            for (String t : ci.getSupportedTypes()) {
                if (mime.equalsIgnoreCase(t)) return true;
            }
        }
        return false;
    }

    /** Full decode -> re-encode loop to HEVC (fallback H.264) keeping aspect ratio within maxDim. */
    private void transcodeLoop(String in, String out, int maxDim) throws Exception {
        MediaExtractor extractor = new MediaExtractor();
        extractor.setDataSource(in);
        int videoTrack = -1, audioTrack = -1;
        String videoMime = null, audioMime = null;
        for (int i = 0; i < extractor.getTrackCount(); i++) {
            MediaFormat fmt = extractor.getTrackFormat(i);
            String mime = fmt.getString(MediaFormat.KEY_MIME);
            if (mime == null) continue;
            if (mime.startsWith("video/") && videoTrack < 0) { videoTrack = i; videoMime = mime; }
            else if (mime.startsWith("audio/") && audioTrack < 0) { audioTrack = i; audioMime = mime; }
        }
        if (videoTrack < 0) { extractor.release(); throw new IllegalStateException("no video track"); }

        MediaFormat inVideo = extractor.getTrackFormat(videoTrack);
        int inW = inVideo.getInteger(MediaFormat.KEY_WIDTH);
        int inH = inVideo.getInteger(MediaFormat.KEY_HEIGHT);
        int outW = inW, outH = inH;
        if (outW > maxDim || outH > maxDim) {
            double scale = Math.min((double) maxDim / outW, (double) maxDim / outH);
            outW = Math.max(2, (int) (outW * scale) & ~1);
            outH = Math.max(2, (int) (outH * scale) & ~1);
        }
        int fps = 30;
        try { fps = Math.min(60, Math.max(1, inVideo.getInteger(MediaFormat.KEY_FRAME_RATE))); } catch (Exception ignored) {}

        boolean useHevc = hasEncoder(MediaFormat.MIMETYPE_VIDEO_HEVC);
        String encMime = useHevc ? MediaFormat.MIMETYPE_VIDEO_HEVC : MediaFormat.MIMETYPE_VIDEO_AVC;
        MediaFormat encFormat = MediaFormat.createVideoFormat(encMime, outW, outH);
        encFormat.setInteger(MediaFormat.KEY_COLOR_FORMAT, MediaCodecInfo.CodecCapabilities.COLOR_FormatSurface);
        int bitrate = 6_000_000;
        encFormat.setInteger(MediaFormat.KEY_BIT_RATE, bitrate);
        encFormat.setInteger(MediaFormat.KEY_FRAME_RATE, fps);
        encFormat.setInteger(MediaFormat.KEY_I_FRAME_INTERVAL, 1);
        if (useHevc) {
            encFormat.setInteger(MediaFormat.KEY_PROFILE, MediaCodecInfo.CodecProfileLevel.HEVCProfileMain);
            encFormat.setInteger(MediaFormat.KEY_COLOR_STANDARD, MediaFormat.COLOR_STANDARD_BT709);
            encFormat.setInteger(MediaFormat.KEY_COLOR_TRANSFER, MediaFormat.COLOR_TRANSFER_SDR_VIDEO);
            encFormat.setInteger(MediaFormat.KEY_COLOR_RANGE, MediaFormat.COLOR_RANGE_LIMITED);
        }

        MediaCodec decoder = MediaCodec.createDecoderByType(videoMime);
        decoder.configure(inVideo, null, null, 0);
        decoder.start();

        MediaCodec encoder = MediaCodec.createEncoderByType(encMime);
        encoder.configure(encFormat, null, null, MediaCodec.CONFIGURE_FLAG_ENCODE);
        android.view.Surface surface = encoder.createInputSurface();
        encoder.start();

        boolean muxerStarted = false;
        MediaMuxer muxer = new MediaMuxer(out, MediaMuxer.OutputFormat.MUXER_OUTPUT_MPEG_4);

        // Audio passthrough channel
        AudioChunk audio = null;
        if (audioTrack >= 0) {
            audio = new AudioChunk(in, audioTrack, audioMime);
        }

        MediaCodec.BufferInfo decInfo = new MediaCodec.BufferInfo();
        MediaCodec.BufferInfo encInfo = new MediaCodec.BufferInfo();
        boolean inputDone = false, outputEnded = false;
        int videoMuxerIndex = -1;

        ByteBuffer decInputBuf;
        ByteBuffer encOutputBuf;

        while (!outputEnded) {
            if (cancelled) break;
            // Feed decoder
            if (!inputDone) {
                int inIndex = decoder.dequeueInputBuffer(10_000);
                if (inIndex >= 0) {
                    decInputBuf = decoder.getInputBuffer(inIndex);
                    if (decInputBuf != null) {
                        decInputBuf.clear();
                        int size = extractor.readSampleData(decInputBuf, 0);
                        if (size >= 0) {
                            decoder.queueInputBuffer(inIndex, 0, size, extractor.getSampleTime(), extractor.getSampleFlags());
                            extractor.advance();
                        } else {
                            decoder.queueInputBuffer(inIndex, 0, 0, 0, MediaCodec.BUFFER_FLAG_END_OF_STREAM);
                            inputDone = true;
                        }
                    }
                }
            }

            // Drain decoder (frame into encoder surface)
            int decOut = decoder.dequeueOutputBuffer(decInfo, 10_000);
            if (decOut >= 0) {
                decoder.releaseOutputBuffer(decOut, true); // render to encoder input surface
            } else if (decOut == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED) {
                android.util.Log.i("FlipTranscoder", "decoder format: " + decoder.getOutputFormat());
            }

            // Drain encoder
            int encOut = encoder.dequeueOutputBuffer(encInfo, 10_000);
            if (encOut >= 0) {
                if (encInfo.size > 0 || (encInfo.flags & MediaCodec.BUFFER_FLAG_END_OF_STREAM) != 0) {
                    encOutputBuf = encoder.getOutputBuffer(encOut);
                    if (encOutputBuf != null && encInfo.size > 0 && videoMuxerIndex >= 0) {
                        ByteBuffer data = encOutputBuf.duplicate();
                        data.position(encInfo.offset);
                        data.limit(encInfo.offset + encInfo.size);
                        if ((encInfo.flags & MediaCodec.BUFFER_FLAG_CODEC_CONFIG) == 0) {
                            muxer.writeSampleData(videoMuxerIndex, data, encInfo);
                        }
                    }
                }
                if ((encInfo.flags & MediaCodec.BUFFER_FLAG_END_OF_STREAM) != 0) {
                    outputEnded = true;
                }
                encoder.releaseOutputBuffer(encOut, false);
            } else if (encOut == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED) {
                if (videoMuxerIndex < 0) {
                    videoMuxerIndex = muxer.addTrack(encoder.getOutputFormat());
                }
            }

            // Start the muxer + add audio channel once the video track is known.
            if (!muxerStarted && audio != null && videoMuxerIndex >= 0) {
                try {
                    if (audio.addTrackToMuxer(muxer)) {
                        audio.added = true;
                        muxer.start();
                        muxerStarted = true;
                    }
                } catch (Exception e) {
                    Log.w("FlipTranscoder", "audio track add failed", e);
                }
            } else if (!muxerStarted && videoMuxerIndex >= 0 && audio == null) {
                muxer.start();
                muxerStarted = true;
            }

            if (audio != null && audio.added) {
                audio.drain(muxer);
            }
        }

        try { muxer.stop(); } catch (Exception e) { Log.w("FlipTranscoder", "muxer stop", e); }
        muxer.release();
        if (audio != null) audio.release();
        encoder.stop(); encoder.release();
        decoder.stop(); decoder.release();
        extractor.release();
    }

    // Minimal audio passthrough drainer (never re-encodes audio)
    private static class AudioChunk {
        MediaExtractor ex;
        int trackIndex;
        int audioIndex = -1;
        boolean added = false;
        MediaFormat format;
        MediaCodec.BufferInfo info = new MediaCodec.BufferInfo();
        boolean done = false;
        long startUs = -1;

        AudioChunk(String in, int trackIndex, String mime) {
            this.trackIndex = trackIndex;
            try {
                ex = new MediaExtractor();
                ex.setDataSource(in);
                ex.selectTrack(trackIndex);
                format = ex.getTrackFormat(trackIndex);
            } catch (Exception e) {
                Log.w("FlipTranscoder", "audio chunk init failed", e);
            }
        }

        /** Adds the (raw) audio track to the muxer. Returns true on success. */
        boolean addTrackToMuxer(MediaMuxer muxer) {
            if (format == null) return false;
            try {
                audioIndex = muxer.addTrack(format);
                return audioIndex >= 0;
            } catch (Exception e) {
                Log.w("FlipTranscoder", "audio addTrack failed", e);
                done = true;
                return false;
            }
        }

        void drain(MediaMuxer muxer) {
            if (done || ex == null || audioIndex < 0) return;
            int bufSize = 512 * 1024;
            try { bufSize = format.getInteger(MediaFormat.KEY_MAX_INPUT_SIZE); } catch (Exception ignored) {}
            ByteBuffer buf = ByteBuffer.allocate(bufSize);
            int n = ex.readSampleData(buf, 0);
            if (n < 0) { done = true; return; }
            info.offset = 0;
            info.size = n;
            long pts = ex.getSampleTime();
            if (startUs < 0) startUs = pts;
            info.presentationTimeUs = Math.max(0, pts - (startUs < 0 ? 0 : startUs));
            info.flags = ex.getSampleFlags();
            ByteBuffer data = buf.duplicate();
            data.position(0);
            data.limit(n);
            try {
                muxer.writeSampleData(audioIndex, data, info);
            } catch (Exception e) {
                done = true;
            }
            ex.advance();
        }

        void release() {
            if (ex != null) { ex.release(); ex = null; }
        }
    }
}
