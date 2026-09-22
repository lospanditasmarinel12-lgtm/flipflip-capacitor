package com.flipflip.transcoder;

import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.ImageDecoder;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.media.MediaCodecInfo;
import android.media.MediaExtractor;
import android.media.MediaFormat;
import android.media.MediaMetadataRetriever;
import android.net.Uri;
import android.util.Log;

import androidx.annotation.OptIn;
import androidx.media3.common.Effect;
import androidx.media3.common.MediaItem;
import androidx.media3.common.MimeTypes;
import androidx.media3.common.util.UnstableApi;
import androidx.media3.effect.ScaleAndRotateTransformation;
import androidx.media3.transformer.AudioEncoderSettings;
import androidx.media3.transformer.Composition;
import androidx.media3.transformer.DefaultEncoderFactory;
import androidx.media3.transformer.EditedMediaItem;
import androidx.media3.transformer.EditedMediaItemSequence;
import androidx.media3.transformer.Effects;
import androidx.media3.transformer.ExportException;
import androidx.media3.transformer.ExportResult;
import androidx.media3.transformer.InAppFragmentedMp4Muxer;
import androidx.media3.transformer.ProgressHolder;
import androidx.media3.transformer.Transformer;
import androidx.media3.transformer.VideoEncoderSettings;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.io.RandomAccessFile;
import java.net.InetAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * FlipTranscoder — native media optimizer for FlipFlip.
 *
 * Normalizes arbitrary user media into a predictable, bounded playback
 * contract for the Capacitor WebView.
 *
 * Decision flow:
 *   PROBE -> ANALYZE -> SELECT PROFILE -> KEEP / LIGHT / AGGRESSIVE -> TRANSCODE IF REQUIRED
 */
@CapacitorPlugin(name = "FlipTranscoder")
public class FlipTranscoderPlugin extends Plugin {

    // MARK: - Configurable profiles

    // --- Image profile ---
    /** Maximum decoded pixel count (~2.5 MP). The pixel budget is the primary optimization criterion. */
    private static final int IMAGE_MAX_PIXELS = 2_500_000;
    private static final int IMAGE_MAX_DIMENSION = 1920;
    /** WebP quality (0-100). ~82 gives good visual quality at reasonable size. */
    private static final int IMAGE_QUALITY = 82;
    /** Secondary file-size cap (still useful for storage, not memory). */
    private static final long IMAGE_MAX_BYTES = 8L * 1024 * 1024;

    // --- Video profile (STANDARD) ---
    private static final int VIDEO_MAX_DIMENSION = 1920;
    private static final int VIDEO_MAX_FPS = 30;
    private static final int VIDEO_TARGET_BITRATE_1080 = 3_750_000;
    private static final long VIDEO_MAX_BITRATE = 20_000_000L;

    /** Resolution-proportional video bitrate (bits/s). Chosen by the output's long
     * edge, then floored by the source's own bitrate so converted output never
     * bloats below-efficient clips. Inputs >VIDEO_MAX_DIMENSION are downscaled
     * before this is applied. */
    private static int videoTargetBitrate(int w, int h, long sourceBitrate) {
        int longEdge = Math.max(w, h);
        int tier = longEdge <= 640 ? 1_750_000          // <=640×640-ish
                 : longEdge <= 1280 ? 2_250_000         // <=720×920 / 720×1280
                 : VIDEO_TARGET_BITRATE_1080;           // 1080p (dimension cap too)
        return sourceBitrate > 0 ? Math.min(tier, (int)(sourceBitrate * 1.15)) : tier;
    }
    private static final long VIDEO_MAX_BYTES = 100L * 1024 * 1024;
    private static final int VIDEO_I_FRAME_INTERVAL = 2;

    // --- Audio profile (unchanged) ---
    private static final long AUDIO_MAX_BYTES = 24L * 1024 * 1024;
    private static final String[] AUDIO_EXTS = {"mp3", "m4a", "aac", "flac", "wav", "aiff", "aif", "ogg", "opus", "wma"};
    private static final String[] AUDIO_FORCE_EXTS = {"ogg", "opus", "wma"};

    // --- Extension sets ---
    private static final String[] IMAGE_EXTS = {"jpg", "jpeg", "png", "tiff", "bmp", "heic", "heif"};
    private static final String[] VIDEO_EXTS = {"mp4", "mov", "m4v", "webm"};

    private static volatile boolean cancelled = false;

    /** Active Media3 Transformer for the current export (cancel wiring). */
    private volatile Transformer activeTransformer;

    private static final ExecutorService SWEEP_EXECUTOR = Executors.newSingleThreadExecutor();

    // MARK: - Helpers

    private File root() {
        return getContext().getFilesDir();
    }

    private File abs(String rel) {
        return new File(root(), rel);
    }

    /** Whether an extension denotes a box-based MP4-family container that must carry a moov box to be playable. */
    private boolean isMp4Container(String ext) {
        return ext.equals("mp4") || ext.equals("mov") || ext.equals("m4v");
    }

    /** True if `f` demultiplexes to at least one video/audio track. A duration
     * based guard would wrongly reject fragmented MP4 output (Media3's
     * InAppFragmentedMp4Muxer writes an initial moov whose mvhd carries no
     * sample durations — those live in the moof fragments, so the platform
     * metadata retriever reports duration 0 for a perfectly playable file). */
    private boolean isPlayableContainer(File f) {
        if (f == null || !f.isFile() || f.length() < 1024) return false;
        MediaExtractor ex = new MediaExtractor();
        try {
            ex.setDataSource(f.getAbsolutePath());
            for (int i = 0; i < ex.getTrackCount(); i++) {
                try {
                    String mime = ex.getTrackFormat(i).getString(MediaFormat.KEY_MIME);
                    if (mime != null && (mime.startsWith("video/") || mime.startsWith("audio/"))) return true;
                } catch (Exception ignored) {}
            }
            return false;
        } catch (Exception e) {
            return false;
        } finally {
            try { ex.release(); } catch (Exception ignored) {}
        }
    }

    /** Publish a finished `.part` output: validate the container structurally,
     * then atomically rename to the final name. Deletes the part otherwise. */
    private boolean publishOutput(File part, File out) {
        if (part == null || !part.isFile()) return false;
        if (!isPlayableContainer(part)) {
            Log.w("FlipTranscoder", "invalid/incomplete output discarded: " + part.getName());
            part.delete();
            return false;
        }
        if (out.exists()) out.delete();
        if (part.renameTo(out)) {
            Log.i("FlipTranscoder", "published " + out.getName() + " (" + out.length() + " bytes)");
            return true;
        }
        Log.w("FlipTranscoder", "rename failed for " + part.getName());
        part.delete();
        return false;
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

    // MARK: - probe()

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
                probeImage(f, rel, ext, call);
                return;
            }
            if (inArray(VIDEO_EXTS, ext)) {
                probeVideo(f, rel, call);
                return;
            }
            if (inArray(AUDIO_EXTS, ext)) {
                probeAudio(f, rel, ext, call);
                return;
            }
        } catch (Exception e) {
            call.resolve(emptyResult("other"));
            return;
        }
        call.resolve(emptyResult("other"));
    }

    private void probeImage(File f, String rel, String ext, PluginCall call) {
        int[] dims = imageDims(f);
        long size = f.length();
        int w = dims[0], h = dims[1];
        int pixelCount = w * h;
        int estimatedDecodedBytes = pixelCount * 4;

        // Determine format name
        String codec = ext;

        // Alpha: only PNG reliably has alpha in browser context
        boolean alpha = ext.equals("png");

        // HDR: HEIC/HEIF are often HDR
        boolean hdr = ext.equals("heic") || ext.equals("heif");

        // Analyze decision
        JSONObject decision = analyzeImageDecision(w, h, pixelCount, size, ext);
        boolean convert = decision.optBoolean("reencode", false);

        try {
            JSObject result = new JSObject();
            result.put("kind", "image");
            result.put("width", w);
            result.put("height", h);
            result.put("convert", convert);
            result.put("pixelCount", pixelCount);
            result.put("estimatedDecodedBytes", estimatedDecodedBytes);
            result.put("fileSize", size);
            result.put("codec", codec);
            result.put("fps", 0);
            result.put("duration", 0);
            result.put("bitDepth", 8);
            result.put("pixelFormat", alpha ? "bgra" : "rgb");
            result.put("hdr", hdr);
            result.put("alpha", alpha);
            // Estimate output: WebP at quality 82, ~0.7 bpp
            int estimatedOutput = convert ? (int)(pixelCount * 0.7 / 8) : 0;
            result.put("estimatedOutputBytes", estimatedOutput);
            result.put("decision", jsFromDecision(decision));
            call.resolve(result);
        } catch (Exception e) {
            call.resolve(emptyResult("other"));
        }
    }

    private JSONObject analyzeImageDecision(int w, int h, int pixelCount, long fileSize, String ext) {
        JSONObject d = new JSONObject();
        try {
            boolean needsDimResize = w > IMAGE_MAX_DIMENSION || h > IMAGE_MAX_DIMENSION;
            boolean needsPixelBudget = pixelCount > IMAGE_MAX_PIXELS;
            boolean needsSizeCap = fileSize > IMAGE_MAX_BYTES;
            boolean needsFormat = ext.equals("heic") || ext.equals("heif");

            if (!needsDimResize && !needsPixelBudget && !needsSizeCap && !needsFormat) {
                d.put("profile", "keep");
                d.put("reencode", false);
                d.put("resize", false);
                d.put("targetWidth", 0);
                d.put("targetHeight", 0);
                return d;
            }

            d.put("profile", "standard");
            d.put("reencode", true);

            if (needsPixelBudget || needsDimResize) {
                d.put("resize", true);
                double scale;
                if (pixelCount > IMAGE_MAX_PIXELS) {
                    scale = Math.sqrt((double) IMAGE_MAX_PIXELS / Math.max(pixelCount, 1));
                } else {
                    scale = Math.min((double) IMAGE_MAX_DIMENSION / Math.max(w, 1),
                                     (double) IMAGE_MAX_DIMENSION / Math.max(h, 1));
                }
                int tw = Math.max(2, (int)(w * scale));
                int th = Math.max(2, (int)(h * scale));
                // Even dimensions
                tw = (tw % 2 != 0) ? tw + 1 : tw;
                th = (th % 2 != 0) ? th + 1 : th;
                d.put("targetWidth", tw);
                d.put("targetHeight", th);
            } else {
                d.put("resize", false);
                d.put("targetWidth", 0);
                d.put("targetHeight", 0);
            }
        } catch (Exception ignored) {}
        return d;
    }

    private void probeVideo(File f, String rel, PluginCall call) {
        long size = f.length();
        int[] vdims = new int[]{0, 0};
        long videobitrate = 0;
        float fps = 30;
        long durationUs = 0;
        String codec = "";
        int bitDepth = 8;
        String pixelFormat = "";
        boolean hdr = false;

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
            String dur = r.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION);
            if (dur != null) {
                try { durationUs = Long.parseLong(dur) * 1000; } catch (Exception ignored) {}
            }
            String fr = r.extractMetadata(MediaMetadataRetriever.METADATA_KEY_CAPTURE_FRAMERATE);
            if (fr != null) {
                try { fps = Float.parseFloat(fr); } catch (Exception ignored) {}
            }
        } catch (Exception ignored) {}

        // Get codec and HDR from MediaExtractor for more detailed info
        MediaExtractor ex = new MediaExtractor();
        try {
            ex.setDataSource(f.getAbsolutePath());
            for (int i = 0; i < ex.getTrackCount(); i++) {
                MediaFormat fmt = ex.getTrackFormat(i);
                String mime = fmt.getString(MediaFormat.KEY_MIME);
                if (mime == null || !mime.startsWith("video/")) continue;
                codec = mime;
                if (fmt.containsKey(MediaFormat.KEY_COLOR_TRANSFER)) {
                    int transfer = fmt.getInteger(MediaFormat.KEY_COLOR_TRANSFER);
                    if (transfer == MediaFormat.COLOR_TRANSFER_ST2084 || transfer >= MediaFormat.COLOR_TRANSFER_HLG) hdr = true;
                }
                if (fmt.containsKey(MediaFormat.KEY_COLOR_STANDARD)) {
                    if (fmt.getInteger(MediaFormat.KEY_COLOR_STANDARD) == MediaFormat.COLOR_STANDARD_BT2020) hdr = true;
                }
                Integer br2 = null;
                try { br2 = fmt.getInteger(MediaFormat.KEY_BIT_RATE); } catch (Exception ignored) {}
                if (br2 != null && br2 > videobitrate) videobitrate = br2;
                // Frame rate from format if not from retriever
                if (fps <= 0 && fmt.containsKey(MediaFormat.KEY_FRAME_RATE)) {
                    try { fps = fmt.getInteger(MediaFormat.KEY_FRAME_RATE); } catch (Exception ignored) {}
                }
                if (fmt.containsKey(MediaFormat.KEY_PROFILE)) {
                    int profile = fmt.getInteger(MediaFormat.KEY_PROFILE);
                    if (profile == MediaCodecInfo.CodecProfileLevel.HEVCProfileMain10) bitDepth = 10;
                }
                break; // first video track
            }
        } catch (Exception ignored) {
        } finally {
            try { ex.release(); } catch (Exception ignored) {}
        }

        if (fps <= 0) fps = 30;
        double duration = durationUs > 0 ? durationUs / 1_000_000.0 : 0;
        int w = vdims[0], h = vdims[1];
        int pixelCount = w * h;
        int estimatedDecodedBytes = pixelCount * 4;
        double pixelRate = (double) w * h * fps;

        // Fallback bitrate calculation from file size and duration
        if (videobitrate <= 0 && duration > 0) {
            videobitrate = (long)(size * 8.0 / duration);
        }

        // A video is complete when it demuxes: duration (moov/mvhd) plus a real
        // video track. Box-header byte-scans misclassify valid files whose moov
        // ends the file or that carry a trailing QuickTime metadata container.
        boolean complete = isMp4Container(extOf(rel)) ? (durationUs > 0 && vdims[0] > 0 && vdims[1] > 0) : true;
        JSONObject decision = analyzeVideoDecision(w, h, (int) fps, videobitrate, size, hdr, pixelRate);
        boolean convert = decision.optBoolean("reencode", false) && complete;

        // Estimate output bytes: targetBitrate * duration / 8
        int targetBitrate = decision.optInt("targetBitrate", 0);
        long estimatedOutput = convert && duration > 0 ? (long)(targetBitrate * duration / 8) : 0;

        try {
            JSObject result = new JSObject();
            result.put("kind", "video");
            result.put("width", w);
            result.put("height", h);
            result.put("convert", convert);
            result.put("complete", complete);
            result.put("pixelCount", pixelCount);
            result.put("estimatedDecodedBytes", estimatedDecodedBytes);
            result.put("fileSize", size);
            result.put("codec", codec);
            result.put("fps", fps);
            result.put("duration", duration);
            result.put("bitDepth", bitDepth);
            result.put("pixelFormat", pixelFormat);
            result.put("hdr", hdr);
            result.put("alpha", false);
            result.put("estimatedOutputBytes", estimatedOutput);
            result.put("decision", jsFromDecision(decision));
            call.resolve(result);
        } catch (Exception e) {
            call.resolve(emptyResult("other"));
        }
    }

    private JSONObject analyzeVideoDecision(int w, int h, int fps, long bitrate, long fileSize, boolean hdr, double pixelRate) {
        JSONObject d = new JSONObject();
        try {
            boolean needsDimResize = Math.max(w, h) > VIDEO_MAX_DIMENSION;
            boolean needsFPS = fps > VIDEO_MAX_FPS;
            boolean needsBitrate = bitrate > VIDEO_MAX_BITRATE;
            boolean needsSizeCap = fileSize > VIDEO_MAX_BYTES;
            boolean needsHDR = hdr;
            boolean needsPixelRate = pixelRate > (double) VIDEO_MAX_DIMENSION * VIDEO_MAX_DIMENSION * VIDEO_MAX_FPS;

            if (!needsDimResize && !needsFPS && !needsBitrate && !needsSizeCap && !needsHDR && !needsPixelRate) {
                d.put("profile", "keep");
                d.put("reencode", false);
                d.put("resize", false);
                d.put("targetWidth", 0);
                d.put("targetHeight", 0);
                d.put("targetFPS", 0);
                d.put("targetBitrate", 0);
                d.put("toneMap", false);
                return d;
            }

            d.put("profile", needsHDR ? "standard_hdr" : "standard");
            d.put("reencode", true);
            d.put("toneMap", needsHDR);
            d.put("targetFPS", needsFPS ? VIDEO_MAX_FPS : fps);

            int tw, th;
            if (needsDimResize || needsPixelRate) {
                d.put("resize", true);
                double scale = (double) VIDEO_MAX_DIMENSION / Math.max(w, h);
                tw = Math.max(2, (int)(w * scale) & ~1);
                th = Math.max(2, (int)(h * scale) & ~1);
                d.put("targetWidth", tw);
                d.put("targetHeight", th);
            } else {
                d.put("resize", false);
                tw = w;
                th = h;
                d.put("targetWidth", tw);
                d.put("targetHeight", th);
            }
            d.put("targetBitrate", videoTargetBitrate(tw, th, bitrate));
        } catch (Exception ignored) {}
        return d;
    }

    private void probeAudio(File f, String rel, String ext, PluginCall call) {
        long size = f.length();
        boolean forced = inArray(AUDIO_FORCE_EXTS, ext);
        boolean convert = forced || size > AUDIO_MAX_BYTES;
        try {
            JSObject result = new JSObject();
            result.put("kind", "audio");
            result.put("width", 0);
            result.put("height", 0);
            result.put("convert", convert);
            result.put("pixelCount", 0);
            result.put("estimatedDecodedBytes", 0);
            result.put("fileSize", size);
            result.put("codec", ext);
            result.put("fps", 0);
            result.put("duration", 0);
            result.put("bitDepth", 0);
            result.put("pixelFormat", "");
            result.put("hdr", false);
            result.put("alpha", false);
            result.put("estimatedOutputBytes", convert ? size / 4 : 0);
            JSONObject decision = new JSONObject();
            decision.put("profile", convert ? "standard" : "keep");
            decision.put("reencode", convert);
            decision.put("resize", false);
            decision.put("targetWidth", 0);
            decision.put("targetHeight", 0);
            decision.put("targetFPS", 0);
            decision.put("targetBitrate", 256_000);
            decision.put("toneMap", false);
            result.put("decision", decision);
            call.resolve(result);
        } catch (Exception e) {
            call.resolve(emptyResult("other"));
        }
    }

    private JSObject emptyResult(String kind) {
        try {
            JSObject r = new JSObject();
            r.put("kind", kind);
            r.put("width", 0);
            r.put("height", 0);
            r.put("convert", false);
            r.put("pixelCount", 0);
            r.put("estimatedDecodedBytes", 0);
            r.put("fileSize", 0);
            r.put("codec", "");
            r.put("fps", 0);
            r.put("duration", 0);
            r.put("bitDepth", 0);
            r.put("pixelFormat", "");
            r.put("hdr", false);
            r.put("alpha", false);
            r.put("estimatedOutputBytes", 0);
            JSONObject d = new JSONObject();
            d.put("profile", "keep");
            d.put("reencode", false);
            d.put("resize", false);
            d.put("targetWidth", 0);
            d.put("targetHeight", 0);
            d.put("targetFPS", 0);
            d.put("targetBitrate", 0);
            d.put("toneMap", false);
            r.put("decision", d);
            return r;
        } catch (Exception e) {
            return new JSObject();
        }
    }

    private JSObject jsFromDecision(JSONObject d) {
        JSObject js = new JSObject();
        try {
            js.put("profile", d.optString("profile", "keep"));
            js.put("resize", d.optBoolean("resize", false));
            js.put("targetWidth", d.optInt("targetWidth", 0));
            js.put("targetHeight", d.optInt("targetHeight", 0));
            js.put("targetFPS", d.optInt("targetFPS", 0));
            js.put("targetBitrate", d.optInt("targetBitrate", 0));
            js.put("toneMap", d.optBoolean("toneMap", false));
            js.put("reencode", d.optBoolean("reencode", false));
        } catch (Exception ignored) {}
        return js;
    }

    // MARK: - convert()

    @PluginMethod
    public void convert(PluginCall call) {
        String rel = call.getString("path");
        if (rel == null || rel.isEmpty()) {
            call.reject("path is required");
            return;
        }
        final boolean keepOriginal = Boolean.TRUE.equals(call.getBoolean("keepOriginal", false));
        final String ext = extOf(rel);
        final String notifLabel = call.getString("notifLabel");
        final PluginCall fcall = call;
        SWEEP_EXECUTOR.execute(() -> {
            MediaOptimizationService.start(getContext(), 0, notifLabel);
            try {
                runConvert(fcall, rel, ext, keepOriginal);
            } catch (Exception e) {
                Log.e("FlipTranscoder", "convert failed", e);
                fcall.resolve(new JSObject().put("outputPath", rel).put("converted", false));
            } finally {
                MediaOptimizationService.stop(getContext());
            }
        });
    }

    private void runConvert(PluginCall call, String rel, String ext, boolean keepOriginal) {
        File f = abs(rel);
        String outRel = rel;
        boolean converted = false;
        cancelled = false;
        if (inArray(IMAGE_EXTS, ext)) {
            String[] r = convertImage(f, rel, keepOriginal);
            outRel = r[0];
            converted = Boolean.parseBoolean(r[1]);
        } else if (inArray(VIDEO_EXTS, ext)) {
            String[] r = convertVideo(f, rel, keepOriginal);
            outRel = r[0];
            converted = Boolean.parseBoolean(r[1]);
        } else if (inArray(AUDIO_EXTS, ext)) {
            String[] r = convertAudio(f, rel, keepOriginal);
            outRel = r[0];
            converted = Boolean.parseBoolean(r[1]);
        }
        if (converted && !outRel.equals(rel)) {
            appendConvertState(rel, outRel, keepOriginal);
        }
        JSObject res = new JSObject().put("outputPath", outRel).put("converted", converted);
        call.resolve(res);
    }

    // MARK: - Image conversion

    private int[] imageDims(File f) {
        BitmapFactory.Options o = new BitmapFactory.Options();
        o.inJustDecodeBounds = true;
        BitmapFactory.decodeFile(f.getAbsolutePath(), o);
        return new int[]{o.outWidth, o.outHeight};
    }

    private String[] convertImage(File f, String rel, boolean keepOriginal) {
        int[] dims = imageDims(f);
        int w = dims[0], h = dims[1];
        int pixelCount = w * h;
        long size = f.length();
        JSONObject decision = analyzeImageDecision(w, h, pixelCount, size, extOf(rel));
        if (!decision.optBoolean("reencode", false)) {
            return new String[]{rel, "false"};
        }

        int targetW = decision.optInt("targetWidth", w);
        int targetH = decision.optInt("targetHeight", h);
        // Ensure target is bounded
        if (targetW <= 0) targetW = Math.min(w, IMAGE_MAX_DIMENSION);
        if (targetH <= 0) targetH = Math.min(h, IMAGE_MAX_DIMENSION);
        final int tw = targetW;
        final int th = targetH;

        Bitmap bmp = null;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            try {
                bmp = ImageDecoder.decodeBitmap(ImageDecoder.createSource(f), (decoder, info, s) -> {
                    decoder.setTargetSize(tw, th);
                    decoder.setAllocator(ImageDecoder.ALLOCATOR_SOFTWARE);
                });
            } catch (Exception e) {
                Log.w("FlipTranscoder", "ImageDecoder failed, falling back", e);
            }
        }
        if (bmp == null) {
            BitmapFactory.Options o = new BitmapFactory.Options();
            int sample = 1;
            while (w / sample > targetW || h / sample > targetH) sample <<= 1;
            o.inSampleSize = sample;
            bmp = BitmapFactory.decodeFile(f.getAbsolutePath(), o);
        }
        if (bmp == null) return new String[]{rel, "false"};

        // Always JPEG — matches the iOS output and the JS optimized-sibling resolver
        // (__sdr1080.jpg). WebP is skipped: WEBP_LOSSY is an enum (not inlined, so it
        // requires API 30+) and produced a NoSuchFieldError crash on Android 10.
        String outRel = dirOf(rel) + stem(rel) + "__sdr1080.jpg";
        File out = abs(outRel);
        boolean saved = false;
        try (FileOutputStream fos = new FileOutputStream(out)) {
            saved = bmp.compress(Bitmap.CompressFormat.JPEG, IMAGE_QUALITY, fos);
        } catch (Exception e) {
            Log.e("FlipTranscoder", "image save failed", e);
        }
        if (bmp != null && !bmp.isRecycled()) bmp.recycle();
        if (!saved || !out.exists() || out.length() == 0) {
            out.delete();
            return new String[]{rel, "false"};
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

    // MARK: - Video conversion

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

    private String[] convertVideo(File f, String rel, boolean keepOriginal) {
        // Probe-based decision model using real video metadata (Bitmap decode
        // cannot read dimensions from a video container).
        long size = f.length();
        int w = 0, h = 0;
        long bitrate = 0;
        float fps = 30;
        boolean hdr = isHdrVideo(f);

        MediaMetadataRetriever r = new MediaMetadataRetriever();
        try {
            r.setDataSource(f.getAbsolutePath());
            String ws = r.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_WIDTH);
            String hs = r.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_HEIGHT);
            if (ws != null) { try { w = Integer.parseInt(ws); } catch (Exception ignored) {} }
            if (hs != null) { try { h = Integer.parseInt(hs); } catch (Exception ignored) {} }
            String bs = r.extractMetadata(MediaMetadataRetriever.METADATA_KEY_BITRATE);
            if (bs != null) { try { bitrate = Long.parseLong(bs); } catch (Exception ignored) {} }
            String fs = r.extractMetadata(MediaMetadataRetriever.METADATA_KEY_CAPTURE_FRAMERATE);
            if (fs != null) { try { fps = Float.parseFloat(fs); } catch (Exception ignored) {} }
        } catch (Exception ignored) {
        } finally {
            try { r.release(); } catch (Exception ignored) {}
        }

        // Format track bitrate is the peak, often higher than the retriever's
        // average — and it is what decides whether re-encoding is worthwhile.
        MediaExtractor ex = new MediaExtractor();
        try {
            ex.setDataSource(f.getAbsolutePath());
            for (int i = 0; i < ex.getTrackCount(); i++) {
                MediaFormat fmt = ex.getTrackFormat(i);
                String mime = fmt.getString(MediaFormat.KEY_MIME);
                if (mime == null || !mime.startsWith("video/")) continue;
                if (w <= 0 && fmt.containsKey(MediaFormat.KEY_WIDTH)) w = fmt.getInteger(MediaFormat.KEY_WIDTH);
                if (h <= 0 && fmt.containsKey(MediaFormat.KEY_HEIGHT)) h = fmt.getInteger(MediaFormat.KEY_HEIGHT);
                if (fps <= 0 && fmt.containsKey(MediaFormat.KEY_FRAME_RATE)) {
                    try { fps = fmt.getInteger(MediaFormat.KEY_FRAME_RATE); } catch (Exception ignored) {}
                }
                if (fmt.containsKey(MediaFormat.KEY_BIT_RATE)) {
                    try {
                        int br = fmt.getInteger(MediaFormat.KEY_BIT_RATE);
                        if (br > bitrate) bitrate = br;
                    } catch (Exception ignored) {}
                }
                break;
            }
        } catch (Exception ignored) {
        } finally {
            try { ex.release(); } catch (Exception ignored) {}
        }

        if (w <= 0 || h <= 0) {
            int[] dims = imageDims(f);
            if (dims[0] > 0 && dims[1] > 0) { w = dims[0]; h = dims[1]; }
        }
        if (fps <= 0) fps = 30;
        double pixelRate = (double) w * h * fps;

        JSONObject decision = analyzeVideoDecision(w, h, (int) fps, bitrate, size, hdr, pixelRate);
        if (!decision.optBoolean("reencode", false)) {
            return new String[]{rel, "false"};
        }

        String outRel = dirOf(rel) + stem(rel) + "__sdr1080.mp4";
        File out = abs(outRel);
        Log.i("FlipTranscoder", "converting video " + rel + " (" + size + " bytes)");
        boolean ok = transcodeVideo(f.getAbsolutePath(), out.getAbsolutePath(),
                decision.optInt("targetWidth", w),
                decision.optInt("targetHeight", h));
        if (ok && out.exists()) {
            Log.i("FlipTranscoder", "video converted -> " + outRel + " (" + out.length() + " bytes)");
        } else if (!ok && !cancelled) {
            Log.w("FlipTranscoder", "video conversion produced no output for " + rel);
        }
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

    // MARK: - Audio conversion (unchanged)

    private String[] convertAudio(File f, String rel, boolean keepOriginal) {
        String ext = extOf(rel);
        boolean forced = inArray(AUDIO_FORCE_EXTS, ext);
        if (!forced && f.length() <= AUDIO_MAX_BYTES) {
            return new String[]{rel, "false"};
        }
        String outRel = dirOf(rel) + stem(rel) + "__aac256.m4a";
        File out = abs(outRel);
        Log.i("FlipTranscoder", "converting audio " + rel + " (" + f.length() + " bytes)");
        boolean ok = transcodeAudio(f.getAbsolutePath(), out.getAbsolutePath());
        if (ok && out.exists()) {
            Log.i("FlipTranscoder", "audio converted -> " + outRel + " (" + out.length() + " bytes)");
        } else if (!ok && !cancelled) {
            Log.w("FlipTranscoder", "audio conversion produced no output for " + rel);
        }
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

    // MARK: - Video transcode (Media3 Transformer)

    private static final long MEDIA3_STALL_MS = 60_000;

    private boolean transcodeVideo(String in, String out, int outW, int outH) {
        long t0 = SystemClock.elapsedRealtime();
        int srcW = 0, srcH = 0;
        int fps = VIDEO_MAX_FPS;
        long srcBitrate = 0;
        boolean hdr = isHdrVideo(new File(in));
        MediaExtractor ex = new MediaExtractor();
        try {
            ex.setDataSource(in);
            for (int i = 0; i < ex.getTrackCount(); i++) {
                MediaFormat fmt = ex.getTrackFormat(i);
                String mime = fmt.getString(MediaFormat.KEY_MIME);
                if (mime == null || !mime.startsWith("video/")) continue;
                if (fmt.containsKey(MediaFormat.KEY_WIDTH) && fmt.containsKey(MediaFormat.KEY_HEIGHT)) {
                    srcW = fmt.getInteger(MediaFormat.KEY_WIDTH);
                    srcH = fmt.getInteger(MediaFormat.KEY_HEIGHT);
                }
                if (fmt.containsKey(MediaFormat.KEY_FRAME_RATE)) {
                    try {
                        int fr = fmt.getInteger(MediaFormat.KEY_FRAME_RATE);
                        if (fr > 0) fps = Math.min(VIDEO_MAX_FPS, fr);
                    } catch (Exception ignored) {}
                }
                if (fmt.containsKey(MediaFormat.KEY_BIT_RATE)) {
                    try { srcBitrate = fmt.getInteger(MediaFormat.KEY_BIT_RATE); } catch (Exception ignored) {}
                }
            }
        } catch (Exception ignored) {
        } finally {
            try { ex.release(); } catch (Exception ignored) {}
        }

        int tw = outW > 0 ? outW : srcW;
        int th = outH > 0 ? outH : srcH;
        float scale = 1f;
        if (srcW > 0 && srcH > 0 && tw > 0 && th > 0) {
            scale = Math.min((float) tw / srcW, (float) th / srcH);
            if (scale <= 0f || scale > 1f) scale = 1f;
        }
        long bitrate = videoTargetBitrate(tw, th, srcBitrate);

        boolean ok = media3Transcode(in, out, false, fps, bitrate, scale, hdr);
        Log.i("FlipTranscoder", "video transcode " + (ok ? "ok" : "FAILED") + " in "
                + (SystemClock.elapsedRealtime() - t0) + "ms: " + out);
        return ok;
    }

    /** Single shared export: H.264 video (+AAC audio) or audio-only AAC, wrapped
     * in a fragmented MP4 (moov box first) so the Android WebView can stream it.
     * The async Media3 Transformer API is bridged onto the calling sweep thread
     * with a latch; all Transformer state calls run on the main looper. */
    @OptIn(markerClass = UnstableApi.class)
    private boolean media3Transcode(String in, String out, boolean audioOnly,
                                    int fps, long bitrate, float scale, boolean toneMap) {
        String outPart = out + ".part";
        new File(outPart).delete();
        final CountDownLatch latch = new CountDownLatch(1);
        final boolean[] finished = new boolean[1];
        final boolean[] ok = new boolean[1];
        final long[] lastActivity = {SystemClock.elapsedRealtime()};
        final int[] lastPct = {-1};
        final Handler main = new Handler(Looper.getMainLooper());

        main.post(() -> {
            try {
                Transformer.Builder tb = new Transformer.Builder(getContext())
                        .setAudioMimeType(MimeTypes.AUDIO_AAC)
                        .setMuxerFactory(new InAppFragmentedMp4Muxer.Factory());
                if (audioOnly) {
                    tb.setEncoderFactory(new DefaultEncoderFactory.Builder(getContext())
                            .setEnableFallback(true)
                            .setRequestedAudioEncoderSettings(
                                    new AudioEncoderSettings.Builder().setBitrate(256_000).build())
                            .build());
                } else {
                    tb.setVideoMimeType(MimeTypes.VIDEO_H264);
                    VideoEncoderSettings ves = new VideoEncoderSettings.Builder()
                            .setBitrate((int) Math.max(200_000, Math.min(20_000_000, bitrate)))
                            .setBitrateMode(MediaCodecInfo.EncoderCapabilities.BITRATE_MODE_VBR)
                            .build();
                    tb.setEncoderFactory(new DefaultEncoderFactory.Builder(getContext())
                            .setEnableFallback(true)
                            .setRequestedVideoEncoderSettings(ves)
                            .build());
                }
                Transformer t = tb.build();
                t.addListener(new Transformer.Listener() {
                    @Override
                    public void onCompleted(Composition composition, ExportResult exportResult) {
                        Log.i("FlipTranscoder", "media3 export completed: " + out);
                        if (activeTransformer == t) activeTransformer = null;
                        ok[0] = true;
                        finished[0] = true;
                        latch.countDown();
                    }

                    @Override
                    public void onError(Composition composition, ExportResult exportResult, ExportException e) {
                        Log.w("FlipTranscoder", "media3 export failed for " + in, e);
                        if (activeTransformer == t) activeTransformer = null;
                        finished[0] = true;
                        latch.countDown();
                    }
                });
                activeTransformer = t;
                EditedMediaItem.Builder eb = new EditedMediaItem.Builder(
                        MediaItem.fromUri(Uri.fromFile(new File(in))));
                if (audioOnly) {
                    eb.setRemoveVideo(true);
                } else {
                    if (fps > 0) eb.setFrameRate(fps);
                    if (scale > 0f && scale < 1f) {
                        eb.setEffects(new Effects(Collections.emptyList(),
                                Collections.singletonList(new ScaleAndRotateTransformation.Builder()
                                        .setScale(scale, scale).build())));
                    }
                }
                List<EditedMediaItem> items = Collections.singletonList(eb.build());
                EditedMediaItemSequence seq = audioOnly
                        ? EditedMediaItemSequence.withAudioFrom(items)
                        : EditedMediaItemSequence.withAudioAndVideoFrom(items);
                Composition.Builder cb = new Composition.Builder(seq);
                if (toneMap && Build.VERSION.SDK_INT >= 29) {
                    cb.setHdrMode(Composition.HDR_MODE_TONE_MAP_HDR_TO_SDR_USING_OPEN_GL);
                }
                t.start(cb.build(), outPart);
            } catch (Exception e) {
                Log.e("FlipTranscoder", "media3 setup failed for " + in, e);
                activeTransformer = null;
                finished[0] = true;
                latch.countDown();
            }
        });

        Runnable pump = new Runnable() {
            @Override
            public void run() {
                if (finished[0]) return;
                Transformer act = activeTransformer;
                if (act == null) {
                    main.postDelayed(this, 200);
                    return;
                }
                if (cancelled) {
                    Log.i("FlipTranscoder", "media3 cancel requested for " + in);
                    try { act.cancel(); } catch (Exception ignored) {}
                    activeTransformer = null;
                    return;
                }
                ProgressHolder holder = new ProgressHolder();
                try {
                    if (act.getProgress(holder) == Transformer.PROGRESS_STATE_AVAILABLE) {
                        if (holder.progress != lastPct[0]) {
                            lastPct[0] = holder.progress;
                            lastActivity[0] = SystemClock.elapsedRealtime();
                        }
                    }
                } catch (Exception ignored) {
                }
                if (SystemClock.elapsedRealtime() - lastActivity[0] > MEDIA3_STALL_MS) {
                    Log.w("FlipTranscoder", "media3 export stalled " + MEDIA3_STALL_MS + "ms, aborting: " + in);
                    try { act.cancel(); } catch (Exception ignored) {}
                    activeTransformer = null;
                    return;
                }
                main.postDelayed(this, 200);
            }
        };
        main.post(pump);

        boolean ran;
        try {
            latch.await();
            ran = ok[0];
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            ran = false;
        } finally {
            main.removeCallbacks(pump);
        }
        boolean valid = ran && publishOutput(new File(outPart), new File(out));
        if (!valid) new File(outPart).delete();
        return valid;
    }

    // MARK: - Audio transcode (Media3 Transformer)

    private boolean transcodeAudio(String in, String out) {
        long t0 = SystemClock.elapsedRealtime();
        boolean ok = media3Transcode(in, out, true, 0, 0, 0f, false);
        Log.i("FlipTranscoder", "audio transcode " + (ok ? "ok" : "failed") + " in "
                + (SystemClock.elapsedRealtime() - t0) / 1000 + "s: " + out);
        return ok;
    }

    @PluginMethod
    public void cancel(PluginCall call) {
        cancelled = true;
        call.resolve();
    }

    /**
     * Returns a loopback-HTTP URL for a media file. The Android WebView's media
     * stack cannot reliably complete range reads through Capacitor's local
     * interceptor (moov/EOF tail reads on moov-at-end containers fail with
     * net::ERR_FAILED -> PIPELINE_ERROR_READ), so media is served over a real
     * loopback socket with correct RFC 7233 range semantics instead.
     */
    @PluginMethod
    public void resolveMediaUrl(PluginCall call) {
        String rel = call.getString("path");
        if (rel == null || rel.isEmpty()) {
            call.reject("path is required");
            return;
        }
        if (!abs(rel).isFile()) {
            call.reject("file not found: " + rel);
            return;
        }
        try {
            MediaServer server = ensureMediaServer();
            call.resolve(new JSObject().put("url", server.urlFor(rel)));
        } catch (Exception e) {
            Log.e("FlipTranscoder", "resolveMediaUrl failed for " + rel, e);
            call.reject("media server unavailable", e);
        }
    }

    private MediaServer ensureMediaServer() throws Exception {
        MediaServer s = MediaServer.instance;
        if (s == null) {
            synchronized (MediaServer.class) {
                s = MediaServer.instance;
                if (s == null) {
                    s = new MediaServer(root());
                    s.start();
                    MediaServer.instance = s;
                }
            }
        }
        return s;
    }

    @PluginMethod
    public void optimizeLibrary(PluginCall call) {
        JSArray pathArr = call.getArray("paths");
        List<String> paths = new ArrayList<>();
        if (pathArr != null) {
            try {
                for (Object o : pathArr.toList()) {
                    if (o instanceof String && !((String) o).isEmpty()) paths.add((String) o);
                }
            } catch (JSONException e) {
                Log.w("FlipTranscoder", "optimizeLibrary: bad paths array", e);
            }
        }
        final boolean keepOriginal = Boolean.TRUE.equals(call.getBoolean("keepOriginal", false));
        if (paths.isEmpty()) {
            call.resolve(new JSObject().put("mapping", new JSArray()).put("canceled", false));
            return;
        }
        cancelled = false;
        final PluginCall fcall = call;
        SWEEP_EXECUTOR.execute(() -> {
            MediaOptimizationService.start(getContext(), paths.size());
            try {
                runLibrarySweep(paths, keepOriginal, fcall);
            } finally {
                MediaOptimizationService.stop(getContext());
            }
        });
    }

    private void runLibrarySweep(List<String> paths, boolean keepOriginal, PluginCall call) {
        // Drop leftover optimized outputs from aborted runs (no moov box) before
        // the sweep so they can never resolve as playable media again.
        repairInvalidOutputs();
        final int total = paths.size();
        List<JSObject> mapping = new ArrayList<>();
        long start = SystemClock.elapsedRealtime();
        for (int i = 0; i < total; i++) {
            if (cancelled) break;
            String rel = paths.get(i);
            String name = rel.substring(rel.lastIndexOf('/') + 1);
            if (isOptimizedOutput(rel)) {
                File stale = abs(rel);
                if (stale.exists() && stale.length() == 0) {
                    if (stale.delete()) Log.i("FlipTranscoder", "deleted stale empty output: " + rel);
                }
                continue;
            }
            notifyLibraryProgress(i + 1, total, name);
            String[] result = new String[]{rel, "false"};
            try {
                result = convertAny(abs(rel), rel, keepOriginal);
            } catch (Exception e) {
                Log.e("FlipTranscoder", "sweep convert failed: " + rel, e);
            }
            if (Boolean.parseBoolean(result[1])) {
                mapping.add(new JSObject().put("from", rel).put("to", result[0]));
                Log.i("FlipTranscoder", "sweep converted " + rel + " -> " + result[0]
                        + " at " + ((SystemClock.elapsedRealtime() - start) / 1000) + "s");
            } else {
                Log.i("FlipTranscoder", "sweep unchanged (ok=false) " + rel
                        + " at " + ((SystemClock.elapsedRealtime() - start) / 1000) + "s");
            }
            persistState(paths, mapping, i + 1, keepOriginal);
        }
        Log.i("FlipTranscoder", "sweep finished: " + mapping.size() + "/" + total
                + " converted, cancelled=" + cancelled + ", elapsed="
                + ((SystemClock.elapsedRealtime() - start) / 1000) + "s");
        JSObject res = new JSObject();
        JSArray arr = new JSArray();
        for (JSObject o : mapping) arr.put(o);
        res.put("mapping", arr);
        res.put("canceled", cancelled);
        abs("optimize-state.json").delete();
        call.resolve(res);
    }

    private String[] convertAny(File f, String rel, boolean keepOriginal) {
        String ext = extOf(rel);
        if (inArray(IMAGE_EXTS, ext)) return convertImage(f, rel, keepOriginal);
        if (inArray(VIDEO_EXTS, ext)) return convertVideo(f, rel, keepOriginal);
        if (inArray(AUDIO_EXTS, ext)) return convertAudio(f, rel, keepOriginal);
        return new String[]{rel, "false"};
    }

    private boolean isOptimizedOutput(String rel) {
        String n = rel.toLowerCase();
        return n.contains("__sdr1080.") || n.contains("__aac256.");
    }

    /** Deletes optimized outputs that are structurally invalid (orphaned partial
     * writes from an aborted/killed transcode), so they can never be resolved as
     * playable media. Scans both the storage root and the `imported/` folder. */
    private void repairInvalidOutputs() {
        List<File> dirs = new ArrayList<>();
        dirs.add(root());
        File imported = new File(root(), "imported");
        if (imported.isDirectory()) dirs.add(imported);
        int deleted = 0;
        for (File dir : dirs) {
            File[] list = dir.listFiles();
            if (list == null) continue;
            for (File file : list) {
                String name = file.getName().toLowerCase();
                if (!name.contains("__sdr1080.") && !name.contains("__aac256.")) continue;
                if (!file.isFile()) continue;
                String ext = extOf(file.getName());
                boolean mediaContainer = ext.equals("mp4") || ext.equals("mov")
                        || ext.equals("m4v") || ext.equals("m4a") || ext.equals("webm");
                if (!mediaContainer) continue; // image/other optimized outputs are valid as-is
                if (isPlayableContainer(file)) continue;
                if (file.delete()) {
                    deleted++;
                    Log.i("FlipTranscoder", "repair: deleted invalid optimized output: " + file.getName());
                }
            }
        }
        if (deleted > 0) {
            Log.i("FlipTranscoder", "repair: removed " + deleted + " invalid optimized output(s)");
        }
    }

    private void persistState(List<String> paths, List<JSObject> mapping, int current, boolean keepOriginal) {
        try {
            JSONObject state = new JSONObject();
            state.put("total", paths.size());
            state.put("current", current);
            state.put("keepOriginal", keepOriginal);
            JSONArray arr = new JSONArray();
            for (JSObject o : mapping) {
                JSONObject e = new JSONObject();
                e.put("from", o.getString("from"));
                e.put("to", o.getString("to"));
                arr.put(e);
            }
            state.put("mapping", arr);
            File tmp = abs("optimize-state.json");
            try (FileOutputStream fos = new FileOutputStream(tmp)) {
                fos.write(state.toString().getBytes("UTF-8"));
            }
            Log.i("FlipTranscoder", "state persisted: " + arr.length() + " mappings");
        } catch (Exception e) {
            Log.w("FlipTranscoder", "state persist failed", e);
        }
    }

    private void notifyLibraryProgress(int current, int total, String name) {
        notifyListeners("progress", new JSObject().put("current", current).put("total", total).put("name", name));
    }

    private void appendConvertState(String from, String to, boolean keepOriginal) {
        try {
            File stateFile = abs("optimize-state.json");
            JSONArray arr = new JSONArray();
            try {
                JSONObject existing = new JSONObject(new String(readAll(stateFile), "UTF-8"));
                JSONArray prev = existing.optJSONArray("mapping");
                arr = prev != null ? prev : new JSONArray();
            } catch (Exception ignored) {}
            JSONObject e = new JSONObject();
            e.put("from", from);
            e.put("to", to);
            arr.put(e);
            JSONObject state = new JSONObject();
            state.put("total", arr.length());
            state.put("current", arr.length());
            state.put("keepOriginal", keepOriginal);
            state.put("mapping", arr);
            try (FileOutputStream fos = new FileOutputStream(stateFile)) {
                fos.write(state.toString().getBytes("UTF-8"));
            }
            Log.i("FlipTranscoder", "convert state journaled: " + from + " -> " + to);
        } catch (Exception e) {
            Log.w("FlipTranscoder", "convert state journal failed", e);
        }
    }

    private byte[] readAll(File f) throws Exception {
        java.io.FileInputStream fis = new java.io.FileInputStream(f);
        try {
            byte[] buf = new byte[(int) Math.min(Math.max(f.length(), 0), 1 << 20)];
            int off = 0, r;
            while (off < buf.length && (r = fis.read(buf, off, buf.length - off)) > 0) off += r;
            return buf;
        } finally {
            fis.close();
        }
    }


    /** Minimal loopback HTTP file server for <video>/<audio> playback. Binds to
     * 127.0.0.1 on a random port and serves files from the app sandbox below a
     * per-process random token, so it is unreachable from the network and from
     * other apps. Implements single-range GET (RFC 7233) plus full-stream GET. */
    static class MediaServer {
        static volatile MediaServer instance;

        private final File root;
        private final String token = UUID.randomUUID().toString().replace("-", "");
        private final ExecutorService pool = Executors.newFixedThreadPool(4, r -> {
            Thread t = new Thread(r, "flip-media-server");
            t.setDaemon(true);
            return t;
        });
        private ServerSocket serverSocket;
        private int port;

        MediaServer(File root) {
            this.root = root;
        }

        void start() throws IOException {
            serverSocket = new ServerSocket(0, 8, InetAddress.getByName("127.0.0.1"));
            port = serverSocket.getLocalPort();
            Thread acceptor = new Thread(() -> {
                while (!serverSocket.isClosed()) {
                    try {
                        Socket s = serverSocket.accept();
                        pool.execute(() -> handle(s));
                    } catch (IOException e) {
                        if (!serverSocket.isClosed()) Log.w("FlipTranscoder", "media accept failed", e);
                        return;
                    }
                }
            }, "flip-media-server-accept");
            acceptor.setDaemon(true);
            acceptor.start();
            Log.i("FlipTranscoder", "media server on 127.0.0.1:" + port);
        }

        String urlFor(String rel) throws Exception {
            String enc = URLEncoder.encode(rel, "UTF-8").replace("+", "%20").replace("%2F", "/");
            return "http://127.0.0.1:" + port + "/flipmedia/" + token + "/" + enc;
        }

        private void handle(Socket socket) {
            try (Socket closeMe = socket;
                 InputStream in = socket.getInputStream();
                 OutputStream out = socket.getOutputStream()) {
                BufferedReader reader = new BufferedReader(new InputStreamReader(in, StandardCharsets.ISO_8859_1), 16 * 1024);
                String requestLine = reader.readLine();
                if (requestLine == null) return;
                String[] parts = requestLine.split(" ");
                if (parts.length < 2) { sendSimple(out, 400, "Bad Request"); return; }
                String method = parts[0];
                String target = parts[1];
                String range = null;
                String line;
                while ((line = reader.readLine()) != null && !line.isEmpty()) {
                    if (line.regionMatches(true, 0, "Range:", 0, 6)) {
                        range = line.substring(6).trim();
                    }
                }
                if (!method.equals("GET")) { sendSimple(out, 405, "Method Not Allowed"); return; }
                File file = resolve(target);
                if (file == null) { sendSimple(out, 404, "Not Found"); return; }
                String mime = mimeFor(file.getName());
                long size = file.length();

                long[] r = null;
                if (range != null) {
                    try {
                        r = parseRange(range, size);
                        if (r == null) { sendSimple(out, 416, "Range Not Satisfiable", "Content-Range: bytes */" + size); return; }
                    } catch (Exception e) {
                        sendSimple(out, 400, "Bad Request");
                        return;
                    }
                }

                RandomAccessFile raf = new RandomAccessFile(file, "r");
                try {
                    if (r != null) {
                        long start = r[0];
                        long end = r[1];
                        if (start >= size || start > end) {
                            sendSimple(out, 416, "Range Not Satisfiable", "Content-Range: bytes */" + size);
                            return;
                        }
                        send(out, 206, "Partial Content", mime, end - start + 1, true, start, end, size, raf);
                    } else {
                        send(out, 200, "OK", mime, size, false, 0, size - 1, size, raf);
                    }
                } finally {
                    raf.close();
                }
            } catch (IOException e) {
                Log.w("FlipTranscoder", "media request error", e);
            }
        }

        private long[] parseRange(String header, long size) throws IOException {
            if (!header.startsWith("bytes=")) throw new IOException("unsupported range unit");
            String spec = header.substring(6).trim();
            if (spec.isEmpty() || spec.contains(",")) throw new IOException("multi-range unsupported");
            int dash = spec.indexOf('-');
            if (dash < 0) throw new IOException("malformed range");
            String startStr = spec.substring(0, dash).trim();
            String endStr = spec.substring(dash + 1).trim();
            long start;
            long end;
            if (startStr.isEmpty()) {
                long suffix = Long.parseLong(endStr);
                if (suffix <= 0) return null;
                start = Math.max(0, size - suffix);
                end = size - 1;
            } else {
                start = Long.parseLong(startStr);
                if (start < 0) throw new IOException("negative start");
                end = endStr.isEmpty() ? size - 1 : Long.parseLong(endStr);
                if (end < 0) throw new IOException("negative end");
                if (end >= size) end = size - 1;
            }
            return new long[]{start, end};
        }

        private File resolve(String target) {
            String prefix = "/flipmedia/" + token + "/";
            if (!target.startsWith(prefix)) return null;
            String query = null;
            int q = target.indexOf('?');
            if (q >= 0) {
                query = target.substring(q + 1);
                target = target.substring(0, q);
            }
            if (!target.startsWith(prefix)) return null;
            String rel = target.substring(prefix.length());
            if (rel.isEmpty() || rel.startsWith("/") || rel.contains("..") || rel.contains("\\")) return null;
            File f = new File(root, rel);
            try {
                String canon = f.getCanonicalPath();
                String rootCanon = root.getCanonicalPath();
                if (!canon.equals(rootCanon) && !canon.startsWith(rootCanon + File.separator)) return null;
            } catch (IOException e) {
                return null;
            }
            return f.isFile() ? f : null;
        }

        private static String mimeFor(String name) {
            String n = name.toLowerCase();
            if (n.endsWith(".mp4")) return "video/mp4";
            if (n.endsWith(".mov")) return "video/quicktime";
            if (n.endsWith(".m4v")) return "video/x-m4v";
            if (n.endsWith(".webm")) return "video/webm";
            if (n.endsWith(".m4a")) return "audio/mp4";
            if (n.endsWith(".mp3")) return "audio/mpeg";
            if (n.endsWith(".aac")) return "audio/aac";
            if (n.endsWith(".flac")) return "audio/flac";
            if (n.endsWith(".wav")) return "audio/wav";
            if (n.endsWith(".aiff") || n.endsWith(".aif")) return "audio/aiff";
            if (n.endsWith(".ogg")) return "audio/ogg";
            if (n.endsWith(".opus")) return "audio/ogg";
            if (n.endsWith(".wma")) return "audio/x-ms-wma";
            return "application/octet-stream";
        }

        private static void sendSimple(OutputStream out, int status, String reason) throws IOException {
            sendSimple(out, status, reason, null);
        }

        private static void sendSimple(OutputStream out, int status, String reason, String extraHeader) throws IOException {
            StringBuilder sb = new StringBuilder();
            sb.append("HTTP/1.1 ").append(status).append(" ").append(reason).append("\r\n");
            sb.append("Content-Length: 0\r\n");
            sb.append("Connection: close\r\n");
            if (extraHeader != null) sb.append(extraHeader).append("\r\n");
            sb.append("\r\n");
            out.write(sb.toString().getBytes(StandardCharsets.ISO_8859_1));
            out.flush();
        }

        private static void send(OutputStream out, int status, String reason, String contentType,
                                 long contentLength, boolean ranged, long start, long end, long total,
                                 RandomAccessFile raf) throws IOException {
            StringBuilder sb = new StringBuilder();
            sb.append("HTTP/1.1 ").append(status).append(" ").append(reason).append("\r\n");
            sb.append("Content-Type: ").append(contentType).append("\r\n");
            sb.append("Content-Length: ").append(contentLength).append("\r\n");
            sb.append("Accept-Ranges: bytes\r\n");
            sb.append("Connection: close\r\n");
            if (ranged) {
                sb.append("Content-Range: bytes ").append(start).append('-').append(end).append('/').append(total).append("\r\n");
            }
            sb.append("\r\n");
            out.write(sb.toString().getBytes(StandardCharsets.ISO_8859_1));
            if (contentLength > 0) {
                raf.seek(start);
                byte[] buf = new byte[64 * 1024];
                long remaining = contentLength;
                while (remaining > 0) {
                    int n = raf.read(buf, 0, (int) Math.min(buf.length, remaining));
                    if (n < 0) break;
                    out.write(buf, 0, n);
                    remaining -= n;
                }
            }
            out.flush();
        }
    }
}
