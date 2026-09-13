// swift-tools-version: 5.9
import PackageDescription

// DO NOT MODIFY THIS FILE - managed by Capacitor CLI commands
let package = Package(
    name: "CapApp-SPM",
    platforms: [.iOS(.v15)],
    products: [
        .library(
            name: "CapApp-SPM",
            targets: ["CapApp-SPM"])
    ],
    dependencies: [
        .package(url: "https://github.com/ionic-team/capacitor-swift-pm.git", exact: "8.4.1"),
        .package(name: "CapacitorCommunityBluetoothLe", path: "../../../node_modules/@capacitor-community/bluetooth-le"),
        .package(name: "CapacitorBrowser", path: "../../../node_modules/@capacitor/browser"),
        .package(name: "CapacitorDevice", path: "../../../node_modules/@capacitor/device"),
        .package(name: "CapacitorFilesystem", path: "../../../node_modules/@capacitor/filesystem"),
        .package(name: "CapacitorShare", path: "../../../node_modules/@capacitor/share"),
        .package(name: "CapacitorSplashScreen", path: "../../../node_modules/@capacitor/splash-screen"),
        .package(name: "CapawesomeCapacitorFilePicker", path: "../../../node_modules/@capawesome/capacitor-file-picker"),
        .package(name: "CapacitorPluginSafeArea", path: "../../../node_modules/capacitor-plugin-safe-area"),
        .package(name: "FlipflipAudioPlayer", path: "../../../plugins/flipflip-audio-player"),
        .package(name: "FlipflipSystemAudio", path: "../../../plugins/flipflip-system-audio"),
        .package(name: "FlipflipTranscoder", path: "../../../plugins/flipflip-transcoder")
    ],
    targets: [
        .target(
            name: "CapApp-SPM",
            dependencies: [
                .product(name: "Capacitor", package: "capacitor-swift-pm"),
                .product(name: "Cordova", package: "capacitor-swift-pm"),
                .product(name: "CapacitorCommunityBluetoothLe", package: "CapacitorCommunityBluetoothLe"),
                .product(name: "CapacitorBrowser", package: "CapacitorBrowser"),
                .product(name: "CapacitorDevice", package: "CapacitorDevice"),
                .product(name: "CapacitorFilesystem", package: "CapacitorFilesystem"),
                .product(name: "CapacitorShare", package: "CapacitorShare"),
                .product(name: "CapacitorSplashScreen", package: "CapacitorSplashScreen"),
                .product(name: "CapawesomeCapacitorFilePicker", package: "CapawesomeCapacitorFilePicker"),
                .product(name: "CapacitorPluginSafeArea", package: "CapacitorPluginSafeArea"),
                .product(name: "FlipflipAudioPlayer", package: "FlipflipAudioPlayer"),
                .product(name: "FlipflipSystemAudio", package: "FlipflipSystemAudio"),
                .product(name: "FlipflipTranscoder", package: "FlipflipTranscoder")
            ]
        )
    ]
)
