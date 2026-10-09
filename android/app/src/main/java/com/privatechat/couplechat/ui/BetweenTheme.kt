package com.privatechat.couplechat.ui

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.ButtonColors
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.TextFieldColors
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color

private val BetweenLightColors = lightColorScheme(
    primary = Color(0xFF07C160),
    onPrimary = Color(0xFF191919),
    primaryContainer = Color(0xFF95EC69),
    onPrimaryContainer = Color(0xFF191919),
    inversePrimary = Color(0xFF7FECA0),
    secondary = Color(0xFF0B6B3A),
    onSecondary = Color(0xFFFFFFFF),
    secondaryContainer = Color(0xFFD8F3DE),
    onSecondaryContainer = Color(0xFF193621),
    tertiary = Color(0xFF4A6250),
    onTertiary = Color(0xFFFFFFFF),
    tertiaryContainer = Color(0xFFDCE8DE),
    onTertiaryContainer = Color(0xFF1E3023),
    background = Color(0xFFF5F5F5),
    onBackground = Color(0xFF191919),
    surface = Color(0xFFFFFFFF),
    onSurface = Color(0xFF191919),
    surfaceVariant = Color(0xFFF5F5F5),
    onSurfaceVariant = Color(0xFF606060),
    surfaceTint = Color(0xFF07C160),
    inverseSurface = Color(0xFF2D312E),
    inverseOnSurface = Color(0xFFF0F2EE),
    error = Color(0xFFB3261E),
    onError = Color(0xFFFFFFFF),
    errorContainer = Color(0xFFF9DEDC),
    onErrorContainer = Color(0xFF410E0B),
    outline = Color(0xFFE5E5E5),
    outlineVariant = Color(0xFFE5E5E5),
    scrim = Color(0xFF000000),
    surfaceBright = Color(0xFFFFFFFF),
    surfaceContainer = Color(0xFFEDEFEA),
    surfaceContainerHigh = Color(0xFFE7E9E5),
    surfaceContainerHighest = Color(0xFFE1E4DF),
    surfaceContainerLow = Color(0xFFF3F5F2),
    surfaceContainerLowest = Color(0xFFFBFCFA),
    surfaceDim = Color(0xFFD5D9D4),
)

private val BetweenDarkColors = darkColorScheme(
    primary = Color(0xFF22D46F),
    onPrimary = Color(0xFF00210D),
    primaryContainer = Color(0xFF275E38),
    onPrimaryContainer = Color(0xFFD4FFD9),
    inversePrimary = Color(0xFF006B36),
    secondary = Color(0xFFA8DDB7),
    onSecondary = Color(0xFF103A20),
    secondaryContainer = Color(0xFF285337),
    onSecondaryContainer = Color(0xFFC3F4CF),
    tertiary = Color(0xFFB8CCBD),
    onTertiary = Color(0xFF25372A),
    tertiaryContainer = Color(0xFF3B4F40),
    onTertiaryContainer = Color(0xFFD7EADD),
    background = Color(0xFF101411),
    onBackground = Color(0xFFE1E3DF),
    surface = Color(0xFF101411),
    onSurface = Color(0xFFE1E3DF),
    surfaceVariant = Color(0xFF232824),
    onSurfaceVariant = Color(0xFFC0C9C1),
    surfaceTint = Color(0xFF22D46F),
    inverseSurface = Color(0xFFE1E3DF),
    inverseOnSurface = Color(0xFF2D312E),
    error = Color(0xFFF2B8B5),
    onError = Color(0xFF601410),
    errorContainer = Color(0xFF8C1D18),
    onErrorContainer = Color(0xFFF9DEDC),
    outline = Color(0xFF8A938B),
    outlineVariant = Color(0xFF3F4840),
    scrim = Color(0xFF000000),
    surfaceBright = Color(0xFF363A36),
    surfaceContainer = Color(0xFF181C19),
    surfaceContainerHigh = Color(0xFF222622),
    surfaceContainerHighest = Color(0xFF2D312D),
    surfaceContainerLow = Color(0xFF141815),
    surfaceContainerLowest = Color(0xFF0A0E0B),
    surfaceDim = Color(0xFF0F1310),
)

@Composable
fun betweenTextButtonColors(): ButtonColors = ButtonDefaults.textButtonColors(
    contentColor = MaterialTheme.colorScheme.secondary,
)

@Composable
fun betweenOutlinedTextFieldColors(): TextFieldColors = OutlinedTextFieldDefaults.colors(
    focusedTextColor = MaterialTheme.colorScheme.onSurface,
    unfocusedTextColor = MaterialTheme.colorScheme.onSurface,
    errorTextColor = MaterialTheme.colorScheme.onSurface,
    cursorColor = MaterialTheme.colorScheme.secondary,
    errorCursorColor = MaterialTheme.colorScheme.error,
    focusedBorderColor = MaterialTheme.colorScheme.secondary,
    unfocusedBorderColor = MaterialTheme.colorScheme.outline,
    errorBorderColor = MaterialTheme.colorScheme.error,
    focusedLabelColor = MaterialTheme.colorScheme.secondary,
    unfocusedLabelColor = MaterialTheme.colorScheme.onSurfaceVariant,
    errorLabelColor = MaterialTheme.colorScheme.error,
    focusedPlaceholderColor = MaterialTheme.colorScheme.onSurfaceVariant,
    unfocusedPlaceholderColor = MaterialTheme.colorScheme.onSurfaceVariant,
)

@Composable
fun BetweenTheme(
    darkTheme: Boolean = isSystemInDarkTheme(),
    content: @Composable () -> Unit,
) {
    MaterialTheme(
        colorScheme = if (darkTheme) BetweenDarkColors else BetweenLightColors,
        content = content,
    )
}
