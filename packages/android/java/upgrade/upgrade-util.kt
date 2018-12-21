package upgrade

import android.content.Context
import android.text.TextUtils
import ConstBase
import core.BaseApp
import core.MubbleLogger
import org.jetbrains.anko.error
import org.jetbrains.anko.verbose
import util.FileBase
import java.io.*
import java.math.BigInteger
import java.security.MessageDigest
import java.security.NoSuchAlgorithmException

object UpgradeUtil: MubbleLogger {

  fun deleteUpgradeFolder() {

    val upgradePath = FileBase.getJsUpgradePath(BaseApp.instance)
    val upgradeDir = File(upgradePath)
    FileBase.deleteRecursive(upgradeDir)
  }

  fun deleteCodeFolder() {

    val codePath = FileBase.getJsCodePath(BaseApp.instance)
    val codeDir = File(codePath)
    FileBase.deleteRecursive(codeDir)
  }

  fun readManifestFromUpgrade(context: Context): String? {

    return FileBase.readFileFromInternal(context, ConstBase.InternalStorage.Upgrade.NAME,
        ConstBase.InternalStorage.Upgrade.MANIFEST_NAME)
  }

  fun writeManifestToUpgrade(context: Context, data: String) {

    FileBase.writeFileToInternal(context, ConstBase.InternalStorage.Upgrade.NAME,
        ConstBase.InternalStorage.Upgrade.MANIFEST_NAME, data.toByteArray())
  }

  fun deleteUpgradeFolder(context: Context) {

    val upgradeDir = File(FileBase.getJsUpgradePath(context))
    FileBase.deleteRecursive(upgradeDir)
  }

  fun copyFileFromCodeToUpgrade(context: Context, inFileName: String): Boolean {
    var fileName = inFileName

    var copyFromPath = FileBase.getJsCodePath(context)
    var copyToPath = FileBase.getJsUpgradePath(context)
    val splitted = fileName.split("/".toRegex()).dropLastWhile { it.isEmpty() }.toTypedArray()

    if (splitted.size > 1) {

      for (i in 0 until splitted.size - 1) {
        copyFromPath += File.separator + splitted[i]
        copyToPath += File.separator + splitted[i]
      }

      fileName = splitted[splitted.size - 1]
    }

    val copyFromDir = File(copyFromPath)

    if (!copyFromDir.exists()) {
      error { "folder doesn't exist" }
      return false
    }

    val copyDirFiles = copyFromDir.listFiles()
    var copyFromFile: File? = null

    for (file in copyDirFiles) {
      if (file.name == fileName) {
        copyFromFile = file
        break
      }
    }

    if (copyFromFile == null) {
      error { "file doesn't exist" }
      return false
    }

    val copyToDir = File(copyToPath)
    copyToDir.mkdirs()
    val copyToFile = File(copyToDir, fileName)

    try {
      val inStream: FileInputStream? = FileInputStream(copyFromFile)
      val out: FileOutputStream? = FileOutputStream(copyToFile)

      val buffer = ByteArray(1024)
      var read: Int = inStream!!.read(buffer)
      while (read != -1) {
        out!!.write(buffer, 0, read)
        read = inStream.read(buffer)
      }

      inStream.close()

      // write the output file (You have now copied the file)
      out!!.flush()
      out.close()

    } catch (e: Exception) {
      error { e.toString() }
      return false
    }

    return true
  }

  fun writeToBinaryFileInUpgrade(context: Context, filePath: String,
                                 fileName: String, byteArray: ByteArray): Boolean {

    verbose { "writeToBinary: $fileName" }
    val fullFilePath = FileBase.getJsUpgradePath(context) + File.separator + filePath
    return FileBase.writeFile(fullFilePath, fileName, byteArray, false)
  }

  fun writeToTextFileInUpgrade(context: Context, filePath: String,
                               fileName: String, data: String): Boolean  {

    verbose { "writeToText: $fileName" }
    val fullFilePath = FileBase.getJsUpgradePath(context) + File.separator + filePath
    return FileBase.writeFile(fullFilePath, fileName, data.toByteArray(), false)
  }

  fun appendToBinaryFileInUpgrade(context: Context, filePath: String,
                                  fileName: String, byteArray: ByteArray): Boolean  {

    verbose { "appendToBinary: $fileName" }
    val fullFilePath = FileBase.getJsUpgradePath(context) + File.separator + filePath
    return FileBase.writeFile(fullFilePath, fileName, byteArray, true)
  }

  fun appendToTextFileInUpgrade(context: Context, filePath: String,
                                fileName: String, data: String): Boolean  {

    verbose { "appendToText: $fileName" }
    val fullFilePath = FileBase.getJsUpgradePath(context) + File.separator + filePath
    return FileBase.writeFile(fullFilePath, fileName, data.toByteArray(), true)
  }

  fun checkMD5(context: Context, md5: String, filePath: String, fileName: String): Boolean {

    if (TextUtils.isEmpty(md5)) {
      error { "MD5 string to compare empty" }
      return false
    }

    val fullFilePath = FileBase.getJsUpgradePath(context) + File.separator + filePath
    val calculatedDigest = calculateMD5(fullFilePath, fileName)

    if (calculatedDigest == null) {
      error { "calculatedDigest null" }
      return false
    }

    return calculatedDigest.equals(md5, ignoreCase = true)
  }

  fun cleanupUpgradeLeavingManifest(context: Context) {

    val upgradeDir = File(FileBase.getJsUpgradePath(context))
    deleteRecursiveLeavingManifest(upgradeDir)
  }

  private fun calculateMD5(fullFilePath: String, fileName: String): String? {

    val dirs = fullFilePath.split("/".toRegex()).dropLastWhile { it.isEmpty() }.toTypedArray()
    var path1 = ""
    for (dir in dirs) {
      path1 += File.separator + dir
    }

    val path = File(path1)
    if (!path.exists()) {
      error { "path doesn't exist to match md5" }
    }

    val dirFiles = path.listFiles()
    var updateFile: File? = null

    for (file in dirFiles) {
      if (file.name == fileName) {
        updateFile = file
        break
      }
    }

    if (updateFile == null) return null

    val digest: MessageDigest
    try {
      digest = MessageDigest.getInstance("MD5")

    } catch (e: NoSuchAlgorithmException) {
      error { "Exception while getting digest: $e" }
      return null
    }

    val inputStream: InputStream
    try {
      inputStream = FileInputStream(updateFile)

    } catch (e: FileNotFoundException) {
      error { "Exception while getting FileInputStream: $e" }
      return null
    }

    val buffer = ByteArray(8192)
    try {
      var read: Int = inputStream.read(buffer)
      while (read > 0) {
        digest.update(buffer, 0, read)
        read = inputStream.read(buffer)
      }

      val md5sum = digest.digest()
      val bigInt = BigInteger(1, md5sum)
      var output = bigInt.toString(16)
      // Fill to 32 chars
      output = String.format("%32s", output).replace(' ', '0')
      return output

    } catch (e: IOException) {
      throw RuntimeException("Unable to process file for MD5", e)

    } finally {
      try {
        inputStream.close()

      } catch (e: IOException) {
        error { "Exception on closing MD5 input stream: $e" }
      }
    }
  }

  private fun deleteRecursiveLeavingManifest(fileOrDirectory: File) {

    if (fileOrDirectory.isDirectory) {
      for (child in fileOrDirectory.listFiles()) {
        deleteRecursiveLeavingManifest(child)
      }
    }

    if (fileOrDirectory.name != ConstBase.InternalStorage.Upgrade.MANIFEST_NAME) {
      fileOrDirectory.delete()
    }
  }



}