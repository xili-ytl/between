package com.privatechat.couplechat.core.update

import android.annotation.TargetApi
import android.content.Context
import android.content.Intent
import android.content.pm.PackageInfo
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.provider.Settings
import androidx.core.content.pm.PackageInfoCompat
import com.king.app.updater.util.AppUtils
import java.io.File
import java.security.MessageDigest

interface UpdateInstallBridge {
    fun canRequestPackageInstalls(): Boolean
    fun unknownSourcesIntent(): Intent
    fun installIntent(file: File): Intent
}

class AndroidUpdatePlatform(context: Context) : UpdateInstallBridge {
    private val applicationContext = context.applicationContext
    private val packageManager = applicationContext.packageManager
    private val identityReader = AndroidApkIdentityReader(packageManager)

    val currentIdentity: ApkIdentity
        get() = requireNotNull(identityReader.fromInstalledPackage(applicationContext.packageName))

    val candidateReader: ApkIdentityReader = ApkIdentityReader(identityReader::fromArchive)

    override fun canRequestPackageInstalls(): Boolean = packageManager.canRequestPackageInstalls()

    override fun unknownSourcesIntent(): Intent = Intent(
        Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
        Uri.parse("package:${applicationContext.packageName}"),
    )

    override fun installIntent(file: File): Intent = AppUtils.getInstallIntent(
        applicationContext,
        file,
        "${applicationContext.packageName}.AppUpdaterFileProvider",
    )
}

private class AndroidApkIdentityReader(private val packageManager: PackageManager) {
    fun fromInstalledPackage(packageName: String): ApkIdentity? = runCatching {
        packageManager.getPackageInfoCompat(packageName)
    }.getOrNull()?.toIdentity()

    fun fromArchive(file: File): ApkIdentity? =
        packageManager.getPackageArchiveInfoCompat(file.absolutePath)?.toIdentity()

    private fun PackageInfo.toIdentity(): ApkIdentity = ApkIdentity(
        packageName = packageName,
        versionCode = PackageInfoCompat.getLongVersionCode(this),
        signerDigests = signerDigests(),
    )

    private fun PackageInfo.signerDigests(): Set<String> =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            signerDigestsFromSigningInfo()
        } else {
            @Suppress("DEPRECATION")
            signatures?.map { signature -> signature.toByteArray().sha256() }?.toSet().orEmpty()
        }

    @TargetApi(Build.VERSION_CODES.P)
    private fun PackageInfo.signerDigestsFromSigningInfo(): Set<String> =
        signingInfo?.apkContentsSigners
            ?.map { signature -> signature.toByteArray().sha256() }
            ?.toSet()
            .orEmpty()

    private fun PackageManager.getPackageInfoCompat(packageName: String): PackageInfo =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            getPackageInfo(packageName, PackageManager.PackageInfoFlags.of(PackageManager.GET_SIGNING_CERTIFICATES.toLong()))
        } else if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            getPackageInfo(packageName, PackageManager.GET_SIGNING_CERTIFICATES)
        } else {
            @Suppress("DEPRECATION")
            getPackageInfo(packageName, PackageManager.GET_SIGNATURES)
        }

    private fun PackageManager.getPackageArchiveInfoCompat(path: String): PackageInfo? =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            getPackageArchiveInfo(path, PackageManager.PackageInfoFlags.of(PackageManager.GET_SIGNING_CERTIFICATES.toLong()))
        } else if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            getPackageArchiveInfo(path, PackageManager.GET_SIGNING_CERTIFICATES)
        } else {
            @Suppress("DEPRECATION")
            getPackageArchiveInfo(path, PackageManager.GET_SIGNATURES)
        }
}

private fun ByteArray.sha256(): String =
    MessageDigest.getInstance("SHA-256").digest(this).joinToString("") { byte -> "%02x".format(byte) }
