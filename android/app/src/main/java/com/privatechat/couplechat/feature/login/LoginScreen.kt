package com.privatechat.couplechat.feature.login

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.privatechat.couplechat.ui.BetweenBrand
import com.privatechat.couplechat.ui.betweenOutlinedTextFieldColors

@Composable
fun LoginScreen(
    state: LoginState,
    onAccountChanged: (String) -> Unit,
    onPasswordChanged: (String) -> Unit,
    onSubmit: () -> Unit,
) {
    Surface(
        modifier = Modifier.fillMaxSize(),
        color = MaterialTheme.colorScheme.surface,
    ) {
        BoxWithConstraints(Modifier.fillMaxSize().imePadding()) {
            val topSpace = (maxHeight * 0.10f).coerceIn(24.dp, 80.dp)
            Column(
                modifier = Modifier
                    .fillMaxSize()
                    .verticalScroll(rememberScrollState())
                    .padding(horizontal = 28.dp)
                    .padding(top = topSpace, bottom = 32.dp),
                verticalArrangement = Arrangement.Top,
                horizontalAlignment = Alignment.CenterHorizontally,
            ) {
                Column(
                    modifier = Modifier.widthIn(max = 400.dp).fillMaxWidth(),
                    horizontalAlignment = Alignment.CenterHorizontally,
                ) {
                    BetweenBrand(
                        modifier = Modifier.fillMaxWidth(),
                        iconSize = 64.dp,
                        iconToChinese = 20.dp,
                        testTag = "login-brand",
                    )
                    Spacer(Modifier.height(32.dp))
                    Column(
                        modifier = Modifier
                            .fillMaxWidth()
                            .testTag("login-form"),
                        verticalArrangement = Arrangement.spacedBy(8.dp),
                    ) {
                        OutlinedTextField(
                            value = state.accountId,
                            onValueChange = onAccountChanged,
                            modifier = Modifier
                                .fillMaxWidth()
                                .heightIn(min = 56.dp),
                            label = { Text("账号") },
                            singleLine = true,
                            shape = RoundedCornerShape(12.dp),
                            colors = betweenOutlinedTextFieldColors(),
                            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                            enabled = !state.submitting,
                        )
                        OutlinedTextField(
                            value = state.password,
                            onValueChange = onPasswordChanged,
                            modifier = Modifier
                                .fillMaxWidth()
                                .heightIn(min = 56.dp),
                            label = { Text("密码") },
                            singleLine = true,
                            shape = RoundedCornerShape(12.dp),
                            colors = betweenOutlinedTextFieldColors(),
                            visualTransformation = PasswordVisualTransformation(),
                            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password),
                            enabled = !state.submitting,
                        )
                        state.error?.let {
                            Text(
                                text = it,
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .testTag("login-error"),
                                color = MaterialTheme.colorScheme.error,
                                fontSize = 13.sp,
                                lineHeight = 22.sp,
                                textAlign = TextAlign.Center,
                            )
                        }
                    }
                    Spacer(Modifier.height(20.dp))
                    Button(
                        onClick = onSubmit,
                        modifier = Modifier
                            .fillMaxWidth()
                            .heightIn(min = 52.dp)
                            .testTag("login-submit"),
                        enabled = !state.submitting,
                        shape = RoundedCornerShape(12.dp),
                        colors = ButtonDefaults.buttonColors(),
                    ) {
                        if (state.submitting) {
                            CircularProgressIndicator(
                                modifier = Modifier.height(20.dp),
                                strokeWidth = 2.dp,
                            )
                        } else {
                            Text("登录")
                        }
                    }
                }
            }
        }
    }
}
